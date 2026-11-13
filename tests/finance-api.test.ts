import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { applyCommand, emptyBook, id, savingsGoalProgress, today, type Book, type SavingsGoal } from '../supabase/functions/_shared/domain.ts';

declare global {
  var Deno: { env: { get(key: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
}
const edge = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: edge.getUser }, rpc: edge.rpc, from: edge.from }) }));
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const userC = '33333333-3333-4333-8333-333333333333';
let db: PGlite;
let handler: (request: Request) => Promise<Response>;
let initial: Book;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;`);
  const migrations = new URL('../supabase/migrations/', import.meta.url);
  await db.exec(readFileSync(new URL('20261112132555_finance.sql', migrations), 'utf8'));
  const preparation = readdirSync(migrations).find(name => name.endsWith('_prepare_finance_request.sql'))!;
  await db.exec(readFileSync(new URL(preparation, migrations), 'utf8'));
  await db.query('insert into auth.users(id) values($1),($2),($3)', [userA, userB, userC]);
  const env: Record<string, string> = { SUPABASE_URL: 'https://local.test', SUPABASE_SERVICE_ROLE_KEY: 'local-only', ALLOWED_ORIGINS: 'https://tiyn-six.vercel.app' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] }, serve: (value: typeof handler) => { handler = value; } });
  await import('../supabase/functions/finance-api/index.ts');
}, 30000);
beforeEach(async () => {
  vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {});
  await db.exec('truncate public.telegram_links, public.finance_books, public.command_receipts, public.rate_limits');
  initial = applyCommand(emptyBook('Локальный тест'), { type: 'onboard', name: 'Тест', accountName: 'Счёт', opening: 100000 });
  await db.query('insert into public.telegram_links(telegram_id,user_id) values(1,$1),(2,$2)', [userA, userB]);
  await db.query('insert into public.finance_books(user_id,state) values($1,$3),($2,$3)', [userA, userB, JSON.stringify(initial)]);
  edge.getUser.mockImplementation(async (token: string) => token === 'invalid' ? { data: { user: null }, error: new Error('JWT expired') } : { data: { user: { id: token } }, error: null });
  edge.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    try {
      const values = name === 'prepare_finance_request'
        ? [args.p_user_id, args.p_request_id, args.p_consume_limit]
        : [args.p_user_id, args.p_expected_revision, args.p_request_id, args.p_command_type, JSON.stringify(args.p_state)];
      const placeholders = values.map((_, i) => `$${i + 1}`).join(',');
      const result = await db.query<{ result: unknown }>(`select public.${name}(${placeholders}) as result`, values);
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error }; }
  });
  edge.from.mockImplementation((table: string) => {
    if (table !== 'finance_books') throw new Error(`Unexpected table ${table}`);
    return {
      select: () => ({ eq: (_: string, user: string) => {
        const read = async () => {
          const result = await db.query<{ state: Book; revision: number }>('select state,revision from public.finance_books where user_id=$1', [user]);
          return { data: result.rows[0] ?? null, error: null };
        };
        return { maybeSingle: read, single: read };
      } }),
      upsert: async (row: { user_id: string; state: Book }) => {
        await db.query('insert into public.finance_books(user_id,state) values($1,$2) on conflict(user_id) do nothing', [row.user_id, JSON.stringify(row.state)]);
        return { error: null };
      },
    };
  });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
const request = (payload: unknown, user = userA) => new Request('https://local.test/functions/v1/finance-api', { method: 'POST', headers: { authorization: `Bearer ${user}`, origin: 'https://tiyn-six.vercel.app', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
const readBook = async (user = userA) => (await db.query<{ state: Book; revision: number }>('select state,revision from public.finance_books where user_id=$1', [user])).rows[0];
const counter = async () => (await db.query<{ attempts: number }>('select attempts from public.rate_limits where key=$1', [`api:${userA}`])).rows[0]?.attempts;

it('loads with one Auth call and one preparation RPC without changing financial state', async () => {
  const before = await readBook(); const response = await handler(request({ action: 'load' }));
  expect(response.status).toBe(200); expect((await response.json()).book).toEqual(initial);
  expect(edge.getUser).toHaveBeenCalledTimes(1); expect(edge.rpc).toHaveBeenCalledTimes(1);
  expect(edge.from).not.toHaveBeenCalled(); expect(await readBook()).toEqual(before);
  expect(await counter()).toBe(1);
});
it('saves with one Auth call, preparation and commit, preserving another user’s book', async () => {
  const other = await readBook(userB);
  const response = await handler(request({ action: 'command', requestId: id(), command: { type: 'settings.update', settings: { name: 'Новое' } } }));
  expect(response.status).toBe(200); expect((await response.json()).book.settings.name).toBe('Новое');
  expect(edge.getUser).toHaveBeenCalledTimes(1);
  expect(edge.rpc.mock.calls.map(call => call[0])).toEqual(['prepare_finance_request', 'commit_finance_book']);
  expect((await readBook()).revision).toBe(1); expect(await readBook(userB)).toEqual(other);
});
it('loads an old cloud book and atomically saves a goal once across duplicate requests', async () => {
  const legacy = JSON.parse(JSON.stringify(initial)); delete legacy.goals;
  await db.query('update public.finance_books set state=$2 where user_id=$1', [userA, JSON.stringify(legacy)]);
  const loaded = await handler(request({ action: 'load' }));
  expect((await loaded.json()).book.goals).toEqual([]);
  const goal: SavingsGoal = { id: id(), name: 'Подушка', targetAmount: 500000, accountId: initial.accounts[0].id, dueDate: '', archived: false };
  const payload = { action: 'command', requestId: id(), command: { type: 'goal.save', goal } };
  expect((await handler(request(payload))).status).toBe(200);
  const saved = await readBook();
  expect(saved.state.goals).toEqual([goal]); expect(saved.state.accounts[0].included).toBe(false);
  expect(saved.state.transactions).toEqual(initial.transactions);
  expect((await handler(request(payload))).status).toBe(200);
  expect(await readBook()).toEqual(saved);
  expect((await readBook(userB)).state).toEqual(initial);
  const { applyToUser } = await import('../supabase/functions/_shared/server.ts');
  const next = await applyToUser(userA, id(), { type: 'transaction.save', transaction: { id: id(), kind: 'income', accountId: goal.accountId, categoryId: initial.categories.find(c => c.type === 'income')!.id, amount: 10000, date: today(), note: 'Проценты через бота' } });
  expect(next.goals).toEqual([goal]);
  expect(savingsGoalProgress(next, goal).balance).toBe(110000);
  expect((await handler(request({ action: 'command', requestId: id(), command: { type: 'settings.update', settings: { theme: 'light' } } }))).status).toBe(200);
  expect((await readBook()).state.goals).toEqual([goal]);
});
it('revalidates a goal against a concurrent claim on the same account', async () => {
  const { prepareFinanceRequest, applyToUser } = await import('../supabase/functions/_shared/server.ts');
  const goal: SavingsGoal = { id: id(), name: 'Подушка', targetAmount: 500000, accountId: initial.accounts[0].id, dueDate: '', archived: false };
  const requestId = id(); const prepared = await prepareFinanceRequest(userA, requestId);
  const concurrent = applyCommand(initial, { type: 'goal.save', goal: { ...goal, id: id(), name: 'Отпуск' } });
  await db.query("select public.commit_finance_book($1,0,$2,'goal.save',$3)", [userA, id(), JSON.stringify(concurrent)]);
  await expect(applyToUser(userA, requestId, { type: 'goal.save', goal }, prepared)).rejects.toThrow('На этом счёте уже есть активная цель');
  expect((await readBook()).state).toEqual(concurrent);
  expect((await readBook()).revision).toBe(1);
});
it('preserves a concurrent income when retrying goal creation after a revision conflict', async () => {
  const { prepareFinanceRequest, applyToUser } = await import('../supabase/functions/_shared/server.ts');
  const goal: SavingsGoal = { id: id(), name: 'Подушка', targetAmount: 500000, accountId: initial.accounts[0].id, dueDate: '', archived: false };
  const requestId = id(); const prepared = await prepareFinanceRequest(userA, requestId);
  const concurrent = applyCommand(initial, { type: 'transaction.save', transaction: { id: id(), kind: 'income', accountId: goal.accountId, categoryId: initial.categories.find(c => c.type === 'income')!.id, amount: 10000, date: today(), note: 'Проценты' } });
  await db.query("select public.commit_finance_book($1,0,$2,'transaction.save',$3)", [userA, id(), JSON.stringify(concurrent)]);
  const next = await applyToUser(userA, requestId, { type: 'goal.save', goal }, prepared);
  expect(next.transactions).toEqual(concurrent.transactions);
  expect(savingsGoalProgress(next, goal).balance).toBe(110000);
  expect(next.accounts[0].included).toBe(false);
  expect((await readBook()).revision).toBe(2);
});
it('returns a completed schedule on retry before reapplying the now-invalid completion', async () => {
  const scheduleId = id();
  const book = applyCommand(initial, { type: 'schedule.save', schedule: { id: scheduleId, name: 'План', kind: 'expense', amount: 1000, accountId: initial.accounts[0].id, categoryId: initial.categories[0].id, dueDate: '2026-11-12', repeat: 'once', dayOfMonth: 12, completed: [], archived: false } });
  await db.query('update public.finance_books set state=$2 where user_id=$1', [userA, JSON.stringify(book)]);
  const payload = { action: 'command', requestId: id(), command: { type: 'schedule.complete', scheduleId, dueDate: '2026-11-12', date: '2026-11-12', amount: 1000 } };
  expect((await handler(request(payload))).status).toBe(200);
  const saved = await readBook(); edge.rpc.mockClear();
  const duplicate = await handler(request(payload)); expect(duplicate.status).toBe(200);
  expect((await duplicate.json()).book.transactions).toHaveLength(1);
  expect(await readBook()).toEqual(saved);
  expect(edge.rpc).toHaveBeenCalledTimes(1);
});
it('retries a revision conflict against fresh state without consuming the rate limit twice', async () => {
  const { prepareFinanceRequest, applyToUser } = await import('../supabase/functions/_shared/server.ts');
  const requestId = id(); const prepared = await prepareFinanceRequest(userA, requestId);
  const concurrent = { ...initial, settings: { ...initial.settings, reserve: 3000 } };
  await db.query("select public.commit_finance_book($1,0,$2,'settings.update',$3)", [userA, id(), JSON.stringify(concurrent)]);
  const next = await applyToUser(userA, requestId, { type: 'settings.update', settings: { name: 'После конфликта' } }, prepared);
  expect(next.settings.reserve).toBe(3000); expect(next.settings.name).toBe('После конфликта');
  expect((await readBook()).revision).toBe(2); expect(await counter()).toBe(1);
  expect(edge.rpc.mock.calls.filter(call => call[0] === 'prepare_finance_request').map(call => call[1].p_consume_limit)).toEqual([true, false]);
});
it('keeps commit-time deduplication when two prepared requests share an ID', async () => {
  const { prepareFinanceRequest, applyToUser } = await import('../supabase/functions/_shared/server.ts');
  const requestId = id(); const first = await prepareFinanceRequest(userA, requestId); const second = await prepareFinanceRequest(userA, requestId);
  const command = { type: 'settings.update' as const, settings: { name: 'Один раз' } };
  await Promise.all([applyToUser(userA, requestId, command, first), applyToUser(userA, requestId, command, second)]);
  expect((await readBook()).revision).toBe(1);
  expect((await db.query('select * from public.command_receipts where request_id=$1', [requestId])).rows).toHaveLength(1);
});
it('preserves the counter and returns 429 when the rate limit is exceeded', async () => {
  await db.query('insert into public.rate_limits(key,window_start,attempts) values($1,floor(extract(epoch from now())/60),120)', [`api:${userA}`]);
  const before = await readBook(); const response = await handler(request({ action: 'load' }));
  expect(response.status).toBe(429); expect(await counter()).toBe(121); expect(await readBook()).toEqual(before);
});
it('counts malformed and invalid commands without changing financial state', async () => {
  const before = await readBook();
  const malformed = request({}); await malformed.text();
  const broken = new Request(malformed.url, { method: 'POST', headers: malformed.headers, body: '{' });
  expect((await handler(broken)).status).toBe(400);
  expect((await handler(request({ action: 'command', requestId: id(), command: { type: 'unknown' } }))).status).toBe(400);
  expect(await counter()).toBe(2); expect(await readBook()).toEqual(before);
});
it('rejects invalid sessions before RPCs, and rejects users without a Telegram link', async () => {
  expect((await handler(request({ action: 'load' }, 'invalid'))).status).toBe(401);
  expect(edge.rpc).not.toHaveBeenCalled();
  const unlinked = await handler(request({ action: 'load' }, userC));
  expect(unlinked.status).toBe(403); expect((await unlinked.json()).book).toBeUndefined();
  expect((await db.query('select * from public.rate_limits')).rows).toHaveLength(0);
});
it('allows only the server role to call preparation, including when rate limiting is skipped', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try { await expect(db.query('select public.prepare_finance_request($1,null,false)', [userA])).rejects.toThrow(/permission denied/); }
    finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try { expect((await db.query<{ result: { status: string } }>('select public.prepare_finance_request($1,null,true) as result', [userA])).rows[0].result.status).toBe('ok'); }
  finally { await db.exec('reset role'); }
});
it('does not create a missing book in preparation, while preserving explicit first-use initialization', async () => {
  await db.query('delete from public.finance_books where user_id=$1', [userA]);
  const prepared = await db.query<{ result: { status: string } }>('select public.prepare_finance_request($1,null,false) as result', [userA]);
  expect(prepared.rows[0].result.status).toBe('book_missing'); expect(await readBook()).toBeUndefined();
  const response = await handler(request({ action: 'load' })); expect(response.status).toBe(200);
  expect((await readBook()).state.onboarded).toBe(false);
  expect((await readBook(userB)).state).toEqual(initial);
});
it('caches allowed preflight checks without accessing Auth or the database', async () => {
  const response = await handler(new Request('https://local.test', { method: 'OPTIONS', headers: { origin: 'https://tiyn-six.vercel.app' } }));
  expect(response.status).toBe(204); expect(response.headers.get('access-control-max-age')).toBe('600');
  expect(response.headers.get('access-control-allow-headers')).toContain('x-region');
  expect(edge.getUser).not.toHaveBeenCalled(); expect(edge.rpc).not.toHaveBeenCalled();
});
