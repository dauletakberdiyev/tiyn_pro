import { expect, it, vi } from 'vitest';
import { sharePending } from '../src/requests';

it('coalesces overlapping loads and allows refreshing once the result settles', async () => {
  const pending = new Map<number, Promise<string>>();
  let finish!: (value: string) => void;
  const load = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const first = sharePending(pending, 0, load);
  const second = sharePending(pending, 0, load);
  expect(second).toBe(first); await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
  finish('budget'); await expect(first).resolves.toBe('budget');
  await sharePending(pending, 0, async () => 'fresh');
  expect(pending.size).toBe(0);
});
it('does not reuse or clear a newer load when an older generation finishes', async () => {
  const pending = new Map<number, Promise<string>>();
  let finishOld!: (value: string) => void; let finishNew!: (value: string) => void;
  const old = sharePending(pending, 0, () => new Promise(resolve => { finishOld = resolve; }));
  const fresh = sharePending(pending, 1, () => new Promise(resolve => { finishNew = resolve; }));
  await Promise.resolve(); finishOld('stale'); await old;
  expect(pending.get(1)).toBe(fresh);
  finishNew('new'); await expect(fresh).resolves.toBe('new'); expect(pending.size).toBe(0);
});
it('allows retrying a failed load instead of retaining a rejected promise', async () => {
  const pending = new Map<number, Promise<string>>();
  await expect(sharePending(pending, 0, async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  await expect(sharePending(pending, 0, async () => 'recovered')).resolves.toBe('recovered');
});
