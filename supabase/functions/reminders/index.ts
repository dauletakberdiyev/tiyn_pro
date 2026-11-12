import { admin, env, json } from '../_shared/server.ts';
import { constantTimeEqual } from '../_shared/telegram-auth.ts';
import { validateBook } from '../_shared/domain.ts';
import { notifications } from '../_shared/notifications.ts';

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!constantTimeEqual(request.headers.get('authorization') ?? '', `Bearer ${env('CRON_SECRET')}`)) return json({ error: 'Unauthorized' }, 401);
  const db = admin();
  let sent = 0;
  try {
    const now = new Date();
    // Personal-budget scale: page through users so the PostgREST row cap cannot
    // silently omit recipients. Each user is isolated if their data is invalid.
    for (let offset = 0; ; offset += 100) {
      const links = await db.from('telegram_links').select('user_id,chat_id').eq('write_access', true).not('chat_id', 'is', null).order('user_id').range(offset, offset + 99);
      if (links.error) throw links.error;
      for (const link of links.data ?? []) {
        const row = await db.from('finance_books').select('state').eq('user_id', link.user_id).maybeSingle();
        if (row.error) throw row.error; if (!row.data) continue;
        const book = validateBook(row.data.state);
        const jobs = notifications(book, now).map(n => ({ user_id: link.user_id, dedup_key: n.key, chat_id: link.chat_id, message: n.message }));
        if (jobs.length) { const saved = await db.from('notification_jobs').upsert(jobs, { onConflict: 'user_id,dedup_key', ignoreDuplicates: true }); if (saved.error) throw saved.error; }
      }
      if ((links.data?.length ?? 0) < 100) break;
    }
    const claimed = await db.rpc('claim_notifications', { p_limit: 10 }); if (claimed.error) throw claimed.error;
    for (const job of claimed.data ?? []) {
      const link = await db.from('telegram_links').select('write_access').eq('user_id', job.user_id).maybeSingle();
      if (!link.data?.write_access) { await db.from('notification_jobs').update({ status: 'cancelled' }).eq('id', job.id); continue; }
      const currentBook = await db.from('finance_books').select('state').eq('user_id', job.user_id).maybeSingle();
      if (currentBook.error) throw currentBook.error;
      const current = currentBook.data ? notifications(validateBook(currentBook.data.state), new Date()).find(n => n.key === job.dedup_key) : null;
      if (!current) { await db.from('notification_jobs').update({ status: 'cancelled' }).eq('id', job.id); continue; }
      try {
        const response = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: job.chat_id, text: current.message, reply_markup: { inline_keyboard: [[{ text: 'Открыть Tiyn', web_app: { url: env('MINI_APP_URL') } }]] } }), signal: AbortSignal.timeout(12000) });
        const result = await response.json();
        if (result.ok) {
          const done = await db.from('notification_jobs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', job.id); if (done.error) throw done.error; sent++;
        } else if (result.error_code === 403) {
          await db.from('telegram_links').update({ write_access: false }).eq('user_id', job.user_id);
          await db.from('notification_jobs').update({ status: 'failed', last_error: 'Bot write access revoked' }).eq('id', job.id);
        } else {
          const wait = Math.max(60, Number(result.parameters?.retry_after ?? 60));
          await db.from('notification_jobs').update({ status: job.attempts >= 3 ? 'failed' : 'retry', available_at: new Date(Date.now() + wait * 1000).toISOString(), last_error: `Telegram ${result.error_code ?? response.status}` }).eq('id', job.id);
        }
      } catch {
        // Telegram has no idempotency key for sendMessage. A network timeout may
        // follow a delivered message, so leave ambiguous deliveries for review.
        await db.from('notification_jobs').update({ status: 'uncertain', last_error: 'Unknown delivery result; no automatic resend' }).eq('id', job.id);
      }
    }
    return json({ ok: true, sent });
  } catch (error) {
    console.error('reminders failed', error instanceof Error ? error.name : 'database');
    return json({ error: 'Notification job failed' }, 500);
  }
});
