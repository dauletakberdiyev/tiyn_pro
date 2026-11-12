import { createClient } from '@supabase/supabase-js';
import { applyCommand, commandSchema, emptyBook, validateBook, type Book, type Command } from './domain.ts';
import { RequestError } from './errors.ts';
export { safeError } from './errors.ts';

export function env(key: string): string {
  const value = Deno.env.get(key); if (!value) throw new Error(`Missing server configuration: ${key}`); return value;
}
export const admin = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
export const publicClient = () => createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim());
  if (origin && !allowed.includes(origin)) throw new Error('Origin is not allowed');
  return { ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
}
export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text(); if (text.length > 32768) throw new Error('Слишком большой запрос');
  return JSON.parse(text);
}
export async function loadBook(userId: string): Promise<{ book: Book; revision: number }> {
  const db = admin();
  let result = await db.from('finance_books').select('state,revision').eq('user_id', userId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) {
    const created = await db.from('finance_books').upsert({ user_id: userId, state: emptyBook() }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (created.error) throw created.error;
    result = await db.from('finance_books').select('state,revision').eq('user_id', userId).single();
  }
  if (result.error || !result.data) throw new Error('Не удалось загрузить бюджет');
  return { book: validateBook(result.data.state), revision: result.data.revision };
}
export interface PreparedBook { book: Book; revision: number; duplicate: boolean }
export async function prepareFinanceRequest(userId: string, requestId?: string, consumeLimit = true): Promise<PreparedBook | null> {
  const { data, error } = await admin().rpc('prepare_finance_request', { p_user_id: userId, p_request_id: requestId ?? null, p_consume_limit: consumeLimit });
  if (error) throw error;
  if (data?.status === 'unlinked') throw new RequestError(403, 'Войдите через Telegram');
  if (data?.status === 'rate_limited') throw new RequestError(429, 'Слишком много запросов. Попробуйте немного позже.');
  if (data?.status === 'book_missing') return null;
  if (data?.status !== 'ok' || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('Не удалось загрузить бюджет');
  return { book: validateBook(data.book), revision: data.revision, duplicate: data.duplicate === true };
}
export async function applyToUser(userId: string, requestId: string, rawCommand: Command, prepared?: PreparedBook | null): Promise<Book> {
  const command = commandSchema.parse(rawCommand);
  const db = admin();
  let context = prepared;
  for (let attempt = 0; attempt < 5; attempt++) {
    // API rate limiting runs once, in the initial prepare. Retries and bot
    // commands retain their existing outer rate limit and do not consume it twice.
    if (context === undefined) context = await prepareFinanceRequest(userId, requestId, false);
    if (context === null) {
      await loadBook(userId); // Preserve first-use initialization, only when missing.
      context = await prepareFinanceRequest(userId, requestId, false);
      if (!context) throw new Error('Не удалось загрузить бюджет');
    }
    if (context.duplicate) return context.book;
    const { book, revision } = context;
    const next = applyCommand(book, command);
    const result = await db.rpc('commit_finance_book', { p_user_id: userId, p_expected_revision: revision, p_request_id: requestId, p_command_type: command.type, p_state: next });
    if (result.error?.code === '40001') { context = undefined; continue; }
    if (result.error) throw result.error;
    return validateBook(result.data.book);
  }
  throw new Error('Бюджет изменился одновременно в другом окне. Повторите действие.');
}
export async function rateLimit(key: string, maximum = 60, window = 60) {
  const { data, error } = await admin().rpc('consume_rate_limit', { p_key: key, p_max: maximum, p_window_seconds: window });
  if (error) throw error;
  if (!data) throw new Error('Слишком много запросов. Попробуйте немного позже.');
}
export async function stableId(input: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
  bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes.slice(0, 16)].map(v => v.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function botApi(method: string, payload: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`Telegram API ${result.error_code ?? response.status}`);
  return result.result;
}
