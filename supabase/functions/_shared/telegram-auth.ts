const encoder = new TextEncoder();
export async function hmac(key: Uint8Array, text: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(text)));
}
export function constantTimeEqual(a: string, b: string): boolean {
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}
export interface TelegramUser { id: number; first_name: string; last_name?: string; allows_write_to_pm?: boolean }
export async function verifyInitData(initData: string, botToken: string, now = Date.now()): Promise<TelegramUser> {
  if (!initData || initData.length > 16384) throw new Error('Некорректные данные Telegram');
  const params = new URLSearchParams(initData);
  const keys = [...params.keys()]; if (new Set(keys).size !== keys.length) throw new Error('Повторяющиеся поля Telegram');
  const authDate = Number(params.get('auth_date'));
  const age = now / 1000 - authDate;
  if (!Number.isSafeInteger(authDate) || age > 900 || age < -30) throw new Error('Сессия Telegram устарела. Откройте приложение заново.');
  const signature = params.get('signature');
  if (signature) {
    const checkString = [...params.entries()].filter(([k]) => k !== 'hash' && k !== 'signature').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const publicKey = Uint8Array.from('e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d'.match(/../g)!, h => parseInt(h, 16));
    const key = await crypto.subtle.importKey('raw', publicKey, 'Ed25519', false, ['verify']);
    let bytes: Uint8Array;
    try { const b64 = signature.replace(/-/g, '+').replace(/_/g, '/'); bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '=')), c => c.charCodeAt(0)); }
    catch { throw new Error('Некорректная подпись Telegram'); }
    const valid = await crypto.subtle.verify('Ed25519', key, bytes as BufferSource, encoder.encode(`${botToken.split(':')[0]}:WebAppData\n${checkString}`));
    if (!valid) throw new Error('Подпись Telegram не прошла проверку');
  } else {
    const checkString = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = await hmac(encoder.encode('WebAppData'), botToken);
    const expected = [...await hmac(secret, checkString)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (!constantTimeEqual(expected, params.get('hash') ?? '')) throw new Error('Подпись Telegram не прошла проверку');
  }
  let user: TelegramUser;
  try { user = JSON.parse(params.get('user') ?? ''); } catch { throw new Error('Пользователь Telegram не найден'); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' || user.first_name.length > 256) throw new Error('Некорректный пользователь Telegram');
  return user;
}
