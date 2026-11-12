import { z } from 'zod';
import { admin, applyToUser, body, cors, json, loadBook, prepareFinanceRequest, safeError } from '../_shared/server.ts';
import { RequestError } from '../_shared/errors.ts';
import { commandSchema } from '../_shared/domain.ts';

Deno.serve(async request => {
  let headers: Record<string, string> = {};
  try {
    headers = cors(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers);
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Необходимо войти через Telegram' }, 401, headers);
    const db = admin(); const { data, error } = await db.auth.getUser(authorization.slice(7));
    if (error || !data.user) return json({ error: 'Сессия истекла. Откройте приложение заново.' }, 401, headers);
    // Even malformed authenticated requests must consume the rate limit. Delay
    // throwing a parse error until the preparation RPC has completed.
    let payload: Record<string, unknown> = {};
    let parseError: unknown;
    try { payload = await body(request); } catch (error) { parseError = error; }
    const requestId = z.string().uuid().safeParse(payload?.action === 'command' ? payload.requestId : undefined);
    const prepared = await prepareFinanceRequest(data.user.id, requestId.success ? requestId.data : undefined);
    if (parseError) throw parseError;
    if (payload?.action === 'load') {
      const result = prepared ?? await loadBook(data.user.id);
      return json({ book: result.book, revision: result.revision }, 200, headers);
    }
    if (payload.action !== 'command') return json({ error: 'Неизвестное действие' }, 400, headers);
    const command = commandSchema.parse(payload.command);
    if (!requestId.success) throw requestId.error;
    return json({ book: await applyToUser(data.user.id, requestId.data, command, prepared) }, 200, headers);
  } catch (error) {
    console.error('finance-api failed', error instanceof Error ? error.name : 'database');
    return json({ error: safeError(error) }, error instanceof RequestError ? error.status : 400, headers);
  }
});
