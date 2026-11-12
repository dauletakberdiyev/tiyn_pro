import { expect, it } from 'vitest';
import { safeError } from '../supabase/functions/_shared/errors.ts';
it('does not expose credential-bearing transport URLs', () => {
  const secretUrl = 'https://api.telegram.org/bot123:secret-token/sendMessage';
  expect(safeError(new TypeError(`error sending request for url (${secretUrl})`))).not.toContain('secret-token');
  expect(safeError(new Error(`Request failed: ${secretUrl}`))).not.toContain('secret-token');
});
it('does not expose database or SDK error objects', () => {
  expect(safeError({ message: 'internal table contents', code: 'XX000' })).not.toContain('internal');
});
it('preserves actionable financial validation messages', () => {
  expect(safeError(new Error('Сумма возврата больше остатка долга'))).toBe('Сумма возврата больше остатка долга');
});
