import { admin, body, cors, env, json, loadBook, publicClient, rateLimit } from '../_shared/server.ts';
import { verifyInitData } from '../_shared/telegram-auth.ts';

Deno.serve(async request => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    const payload = await body(request);
    if (typeof payload.initData !== 'string') return json({ error: 'Откройте приложение через Telegram' }, 400, headers);
    const user = await verifyInitData(payload.initData, env('TELEGRAM_BOT_TOKEN'));
    await rateLimit(`login:${user.id}`, 12, 900);
    const db = admin();
    // The address is an internal identifier. No email is sent. Only the server
    // generates and consumes the one-time token, after verifying Telegram.
    const email = `telegram-${user.id}@tiyn.invalid`;
    const identity = await db.rpc('find_telegram_auth_user', { p_telegram_id: user.id });
    if (identity.error) throw identity.error;
    if (!identity.data) {
      const created = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { telegram_id: user.id } });
      if (created.error) {
        // A concurrent login may have created the same unique email.
        const recovered = await db.rpc('find_telegram_auth_user', { p_telegram_id: user.id });
        if (recovered.error || !recovered.data) throw new Error('Не удалось создать профиль');
      }
    }
    const { data: link, error } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    if (error || !link.properties?.hashed_token || !link.user) throw new Error('Не удалось создать сессию');
    const { data: session, error: verifyError } = await publicClient().auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
    if (verifyError || !session.session) throw new Error('Не удалось подтвердить сессию');
    const previous = await db.from('telegram_links').select('write_access').eq('telegram_id', user.id).maybeSingle();
    if (previous.error) throw previous.error;
    const mapped = await db.from('telegram_links').upsert({ telegram_id: user.id, user_id: link.user.id, chat_id: user.id, write_access: user.allows_write_to_pm === true || previous.data?.write_access === true, updated_at: new Date().toISOString() }, { onConflict: 'telegram_id' });
    if (mapped.error) throw mapped.error;
    const { book, revision } = await loadBook(link.user.id);
    return json({ session: { access_token: session.session.access_token, refresh_token: session.session.refresh_token }, book, revision }, 200, headers);
  } catch (error) {
    console.error('telegram-login failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Не удалось войти. Закройте Mini App и откройте его заново.' }, 401, headers);
  }
});
