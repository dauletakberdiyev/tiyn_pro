-- Run after adding tiyn_supabase_url and tiyn_cron_secret to Supabase Vault.
-- Keep secret values out of this file and out of Git.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule('tiyn-reminders', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tiyn_supabase_url') || '/functions/v1/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tiyn_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

select cron.schedule('tiyn-cleanup', '15 2 * * *', $$
  delete from public.bot_drafts where expires_at < now() - interval '1 day';
  delete from public.telegram_updates where status = 'done' and created_at < now() - interval '14 days';
$$);

