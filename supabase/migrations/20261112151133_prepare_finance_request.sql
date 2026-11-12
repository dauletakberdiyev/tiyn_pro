-- DDL only: existing budgets, identities, receipts and rate counters are not
-- modified by applying this migration. The function runs only for live requests.
create function public.prepare_finance_request(
  p_user_id uuid,
  p_request_id uuid default null,
  p_consume_limit boolean default true
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  current_state jsonb;
  current_revision bigint;
  is_duplicate boolean;
begin
  if not exists(select 1 from public.telegram_links where user_id = p_user_id) then
    return jsonb_build_object('status', 'unlinked');
  end if;

  -- Return refusals as values so the counter update is committed, rather than
  -- rolled back by an exception in this RPC or by later command validation.
  if p_consume_limit and not public.consume_rate_limit('api:' || p_user_id::text, 120, 60) then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  -- One statement gives book, revision and receipt a consistent read snapshot.
  -- No row lock is held across the subsequent TypeScript calculation.
  select b.state, b.revision,
    exists(select 1 from public.command_receipts r where r.user_id = b.user_id and r.request_id = p_request_id)
  into current_state, current_revision, is_duplicate
  from public.finance_books b where b.user_id = p_user_id;

  if not found then
    return jsonb_build_object('status', 'book_missing');
  end if;
  return jsonb_build_object('status', 'ok', 'book', current_state, 'revision', current_revision, 'duplicate', is_duplicate);
end;
$$;

revoke all on function public.prepare_finance_request(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.prepare_finance_request(uuid,uuid,boolean) to service_role;
