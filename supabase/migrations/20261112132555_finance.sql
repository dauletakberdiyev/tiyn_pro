-- The user's book is an atomic aggregate. Commands are validated by the same
-- TypeScript domain on the server and in local mode. Clients cannot write JSON
-- directly: only the service-role command handler can commit a revision.
create table public.finance_books (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null check (coalesce(
    jsonb_typeof(state) = 'object' and state->>'schemaVersion' = '1'
    and jsonb_typeof(state->'accounts') = 'array'
    and jsonb_typeof(state->'transactions') = 'array'
    and octet_length(state::text) <= 12000000
  ,false)),
  updated_at timestamptz not null default now()
);
create table public.telegram_links (
  telegram_id bigint primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  chat_id bigint,
  write_access boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.command_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  revision bigint not null,
  command_type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create table public.bot_drafts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  expires_at timestamptz not null default now() + interval '1 hour',
  consumed_at timestamptz
);
create table public.telegram_updates (
  update_id bigint primary key,
  status text not null check (status in ('processing','done')),
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dedup_key text not null,
  chat_id bigint not null,
  message text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','retry','uncertain','cancelled','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  sent_at timestamptz,
  last_error text,
  unique(user_id, dedup_key)
);
create index notification_pending on public.notification_jobs(status, available_at);
create table public.rate_limits (
  key text primary key,
  window_start bigint not null,
  attempts integer not null
);

alter table public.finance_books enable row level security;
alter table public.telegram_links enable row level security;
alter table public.command_receipts enable row level security;
alter table public.bot_drafts enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.notification_jobs enable row level security;
alter table public.rate_limits enable row level security;

create policy own_book_read on public.finance_books for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.finance_books, public.telegram_links, public.command_receipts,
  public.bot_drafts, public.telegram_updates, public.notification_jobs, public.rate_limits from anon, authenticated;
grant select on public.finance_books to authenticated;
grant all on public.finance_books, public.telegram_links, public.command_receipts,
  public.bot_drafts, public.telegram_updates, public.notification_jobs, public.rate_limits to service_role;

create function public.commit_finance_book(
  p_user_id uuid, p_expected_revision bigint, p_request_id uuid,
  p_command_type text, p_state jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare existing public.finance_books; next_revision bigint;
begin
  select * into existing from public.finance_books where user_id = p_user_id for update;
  if not found then raise exception 'Book missing'; end if;
  if exists(select 1 from public.command_receipts where user_id = p_user_id and request_id = p_request_id) then
    return jsonb_build_object('book', existing.state, 'revision', existing.revision, 'duplicate', true);
  end if;
  if existing.revision <> p_expected_revision then
    raise exception 'Revision conflict' using errcode = '40001';
  end if;
  next_revision := existing.revision + 1;
  update public.finance_books set state = p_state, revision = next_revision, updated_at = now() where user_id = p_user_id;
  insert into public.command_receipts(user_id, request_id, revision, command_type)
    values(p_user_id, p_request_id, next_revision, p_command_type);
  if p_command_type = 'reset' then
    delete from public.notification_jobs where user_id = p_user_id;
    delete from public.bot_drafts where user_id = p_user_id;
  end if;
  return jsonb_build_object('book', p_state, 'revision', next_revision, 'duplicate', false);
end;
$$;

create function public.consume_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare win bigint; attempt_count integer;
begin
  win := floor(extract(epoch from now()) / p_window_seconds);
  insert into public.rate_limits(key, window_start, attempts) values(p_key, win, 1)
    on conflict(key) do update set
      attempts = case when rate_limits.window_start = win then rate_limits.attempts + 1 else 1 end,
      window_start = win
    returning attempts into attempt_count;
  return attempt_count <= p_max;
end;
$$;

-- Only the verified Telegram bridge may resolve an internal Auth identity.
-- This also recovers an Auth user if a prior login stopped before mapping it.
create function public.find_telegram_auth_user(p_telegram_id bigint)
returns uuid language sql security definer set search_path = public, pg_temp as $$
  select id from auth.users where email = 'telegram-' || p_telegram_id::text || '@tiyn.invalid' limit 1;
$$;

create function public.claim_telegram_update(p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed bigint;
begin
  insert into public.telegram_updates(update_id,status,lease_until)
    values(p_update_id,'processing',now() + interval '90 seconds')
    on conflict(update_id) do update set lease_until = now() + interval '90 seconds'
      where telegram_updates.status <> 'done' and telegram_updates.lease_until < now()
    returning update_id into claimed;
  return claimed is not null;
end;
$$;

create function public.claim_notifications(p_limit integer default 30)
returns setof public.notification_jobs language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- An expired send lease has an unknown delivery result. Do not blindly resend.
  update public.notification_jobs set status = 'uncertain', last_error = 'Send lease expired; manual review required'
    where status = 'sending' and lease_until < now();
  return query
    with selected as (
      select id from public.notification_jobs
      where status in ('pending','retry') and available_at <= now() and attempts < 3
      order by available_at for update skip locked limit least(p_limit, 100)
    )
    update public.notification_jobs j set status = 'sending', lease_until = now() + interval '90 seconds', attempts = j.attempts + 1
    from selected s where j.id = s.id returning j.*;
end;
$$;

revoke all on function public.commit_finance_book(uuid,bigint,uuid,text,jsonb),
  public.consume_rate_limit(text,integer,integer), public.claim_telegram_update(bigint),
  public.claim_notifications(integer), public.find_telegram_auth_user(bigint) from public, anon, authenticated;
grant execute on function public.commit_finance_book(uuid,bigint,uuid,text,jsonb),
  public.consume_rate_limit(text,integer,integer), public.claim_telegram_update(bigint),
  public.claim_notifications(integer), public.find_telegram_auth_user(bigint) to service_role;
