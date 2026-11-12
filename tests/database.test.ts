import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyBook, id } from '../supabase/functions/_shared/domain.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text unique);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
  `);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261112132555_finance.sql', import.meta.url), 'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)', [userA, userB]);
  await db.query('insert into public.finance_books(user_id,state) values($1,$3),($2,$3)', [userA, userB, JSON.stringify(emptyBook())]);
}, 30000);
afterAll(async () => { await db?.close(); });

describe('Supabase SQL migration and access controls', () => {
  it('RLS returns only the authenticated owner’s book', async () => {
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userA]);
    const result = await db.query<{ user_id: string }>('select user_id from public.finance_books');
    await db.exec('reset role');
    expect(result.rows.map(r => r.user_id)).toEqual([userA]);
  });
  it('authenticated clients cannot directly overwrite the book or call privileged commits', async () => {
    await db.exec('set role authenticated');
    try {
      await expect(db.query('update public.finance_books set revision=999 where user_id=$1', [userA])).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.commit_finance_book($1,0,$2,\'reset\',$3)', [userA, id(), JSON.stringify(emptyBook())])).rejects.toThrow(/permission denied/);
    } finally { await db.exec('reset role'); }
  });
  it('commits exactly one revision for a repeated request and rejects a stale writer', async () => {
    const requestId = id(); const state = emptyBook('Первый');
    const first = await db.query<{ result: { revision: number; duplicate: boolean } }>('select public.commit_finance_book($1,0,$2,\'onboard\',$3) as result', [userA, requestId, JSON.stringify(state)]);
    expect(first.rows[0].result.revision).toBe(1);
    const second = await db.query<{ result: { revision: number; duplicate: boolean } }>('select public.commit_finance_book($1,0,$2,\'onboard\',$3) as result', [userA, requestId, JSON.stringify(emptyBook('Дубль'))]);
    expect(second.rows[0].result.duplicate).toBe(true); expect(second.rows[0].result.revision).toBe(1);
    await expect(db.query('select public.commit_finance_book($1,0,$2,\'reset\',$3)', [userA, id(), JSON.stringify(state)])).rejects.toThrow(/Revision conflict/);
  });
  it('deduplicates Telegram updates and respects processing leases', async () => {
    const first = await db.query<{ ok: boolean }>('select public.claim_telegram_update(1234) as ok');
    const second = await db.query<{ ok: boolean }>('select public.claim_telegram_update(1234) as ok');
    expect(first.rows[0].ok).toBe(true); expect(second.rows[0].ok).toBe(false);
  });
  it('rate limits are enforced atomically', async () => {
    await db.query("select public.consume_rate_limit('test',1,60)");
    const result = await db.query<{ ok: boolean }>("select public.consume_rate_limit('test',1,60) as ok"); expect(result.rows[0].ok).toBe(false);
  });
  it('notification claims cannot return an in-flight message twice', async () => {
    await db.query("insert into public.notification_jobs(user_id,dedup_key,chat_id,message) values($1,'test',123,'Платёж')", [userA]);
    const first = await db.query('select * from public.claim_notifications(30)'); const second = await db.query('select * from public.claim_notifications(30)');
    expect(first.rows).toHaveLength(1); expect(second.rows).toHaveLength(0);
    await db.exec("update public.notification_jobs set lease_until = now() - interval '1 minute' where status='sending'");
    await db.query('select * from public.claim_notifications(30)');
    const result = await db.query<{ status: string }>('select status from public.notification_jobs'); expect(result.rows[0].status).toBe('uncertain');
  });
  it('reset also removes financial text from notification logs and bot drafts', async () => {
    await db.query('insert into public.bot_drafts(id,user_id,payload) values($1,$2,$3)', [id(), userA, JSON.stringify({ note: 'Личная финансовая запись' })]);
    const requestId = id();
    await db.query("select public.commit_finance_book($1,1,$2,'reset',$3)", [userA, requestId, JSON.stringify(emptyBook())]);
    expect((await db.query('select * from public.notification_jobs where user_id=$1', [userA])).rows).toHaveLength(0);
    expect((await db.query('select * from public.bot_drafts where user_id=$1', [userA])).rows).toHaveLength(0);
    expect((await db.query('select * from public.command_receipts where user_id=$1 and request_id=$2', [userA, requestId])).rows).toHaveLength(1);
  });
});
