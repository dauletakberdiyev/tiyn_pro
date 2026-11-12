import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyBook } from '../supabase/functions/_shared/domain.ts';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), setSession: vi.fn(), invoke: vi.fn(), telegram: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  FunctionRegion: { ApSoutheast2: 'ap-southeast-2' },
  createClient: () => ({ auth: mocks, functions: { invoke: mocks.invoke } }),
}));
vi.mock('../src/telegram', () => ({ telegram: mocks.telegram }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
  mocks.telegram.mockReturnValue({ initData: 'signed-telegram-data' });
  mocks.setSession.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());

it('uses the login book without a second finance request after installing the session', async () => {
  const book = emptyBook('Вход'); const session = { access_token: 'access', refresh_token: 'refresh' };
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.invoke.mockResolvedValue({ data: { session, book, revision: 2 }, error: null });
  const { loadCloudBook } = await import('../src/cloud');
  expect(await loadCloudBook()).toEqual(book);
  expect(mocks.setSession).toHaveBeenCalledWith(session);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('telegram-login', { body: { initData: 'signed-telegram-data' }, region: 'ap-southeast-2' });
});
it('loads an existing session in Sydney without logging in again', async () => {
  const book = emptyBook();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: 'existing' } } });
  mocks.invoke.mockResolvedValue({ data: { book }, error: null });
  const { loadCloudBook } = await import('../src/cloud');
  expect(await loadCloudBook()).toEqual(book);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('finance-api', { body: { action: 'load' }, region: 'ap-southeast-2' });
  expect(mocks.setSession).not.toHaveBeenCalled();
});
it('keeps compatibility with the previous login response during rollout', async () => {
  const book = emptyBook();
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.invoke.mockResolvedValueOnce({ data: { session: { access_token: 'a', refresh_token: 'r' } }, error: null }).mockResolvedValueOnce({ data: { book }, error: null });
  const { loadCloudBook } = await import('../src/cloud');
  expect(await loadCloudBook()).toEqual(book);
  expect(mocks.invoke.mock.calls.map(call => call[0])).toEqual(['telegram-login', 'finance-api']);
});
it('does not accept a login book when installing the session fails', async () => {
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.invoke.mockResolvedValue({ data: { session: { access_token: 'a', refresh_token: 'r' }, book: emptyBook() }, error: null });
  mocks.setSession.mockResolvedValue({ error: new Error('failed') });
  const { loadCloudBook } = await import('../src/cloud');
  await expect(loadCloudBook()).rejects.toThrow('Не удалось сохранить сессию');
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
