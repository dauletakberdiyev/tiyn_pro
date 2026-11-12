import type { SupabaseClient } from '@supabase/supabase-js';
import { validateBook, type Book } from '../supabase/functions/_shared/domain.ts';
import { telegram } from './telegram';

const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const isDemo = !url || !publicKey;
let clientPromise: Promise<SupabaseClient> | undefined;
async function client() {
  if (isDemo) throw new Error('Supabase не настроен');
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url, publicKey));
  return clientPromise;
}
async function invokeFunction(name: string, body: object) {
  const supabase = await client();
  const { FunctionRegion } = await import('@supabase/supabase-js');
  return supabase.functions.invoke(name, { body, region: FunctionRegion.ApSoutheast2 });
}

export async function cloudCall(payload: object): Promise<Book> {
  const { data, error } = await invokeFunction('finance-api', payload);
  if (error) {
    const response = 'context' in error ? error.context as Response : null;
    let message = 'Не удалось связаться с сервером. Ввод сохранён в форме, попробуйте ещё раз.';
    try { const body = await response?.json(); if (body?.error) message = body.error; } catch { /* transport error */ }
    throw new Error(message);
  }
  if (data.error) throw new Error(data.error);
  return validateBook(data.book);
}
export async function loadCloudBook(): Promise<Book> {
  const supabase = await client();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const initData = telegram()?.initData;
    if (!initData) throw new Error('Откройте Tiyn через Telegram-бота, чтобы войти в свой бюджет.');
    const { data, error } = await invokeFunction('telegram-login', { initData });
    if (error || !data?.session) throw new Error(data?.error ?? 'Не удалось войти через Telegram. Закройте приложение и откройте его снова.');
    const result = await supabase.auth.setSession(data.session);
    if (result.error) throw new Error('Не удалось сохранить сессию Telegram');
    // Older deployments may return only a session during a rolling update.
    if (data.book) return validateBook(data.book);
  }
  return cloudCall({ action: 'load' });
}
