import { useCallback, useEffect, useRef, useState } from 'react';
import { applyCommand, id, validateBook, type Book, type Command } from '../supabase/functions/_shared/domain.ts';
import { demoBook } from './demo';
import { telegram } from './telegram';
import { cloudCall, isDemo, loadCloudBook } from './cloud';
import { sharePending } from './requests';
export { isDemo } from './cloud';

const STORAGE_KEY = 'tiyn.demo.v1';

async function loadBook(): Promise<Book> {
  if (isDemo) {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { return validateBook(JSON.parse(saved)); }
      catch { throw new Error('Локальные данные не удалось прочитать. Экспортируйте сохранённое значение tiyn.demo.v1 перед очисткой хранилища.'); }
    }
    const book = demoBook(); localStorage.setItem(STORAGE_KEY, JSON.stringify(book)); return book;
  }
  return loadCloudBook();
}

export function useBook() {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(isDemo && localStorage.getItem('tiyn.sample') !== 'false');
  const active = useRef(false);
  const current = useRef<Book | null>(null);
  const pending = useRef(new Map<string, string>());
  const generation = useRef(0);
  const loading = useRef(new Map<number, Promise<void>>());
  const accept = useCallback((next: Book) => { current.current = next; setBook(next); }, []);
  const reload = useCallback(() => {
    if (active.current) return Promise.resolve();
    const started = generation.current;
    return sharePending(loading.current, started, async () => {
      try { const next = await loadBook(); if (!active.current && generation.current === started) { accept(next); setError(''); } }
      catch (e) { if (!active.current && generation.current === started) setError(e instanceof Error ? e.message : 'Не удалось загрузить бюджет'); }
    });
  }, [accept]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (isDemo) return;
    const refresh = () => { if (document.visibilityState === 'visible' && !active.current) void reload(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [reload]);
  const mutate = useCallback(async (command: Command) => {
    if (active.current) throw new Error('Дождитесь завершения предыдущего действия');
    if (!current.current) throw new Error('Бюджет ещё загружается');
    active.current = true; generation.current++; setBusy(true);
    const signature = JSON.stringify(command);
    const requestId = pending.current.get(signature) ?? id(); pending.current.set(signature, requestId);
    try {
      const next = isDemo ? applyCommand(current.current, command) : await cloudCall({ action: 'command', command, requestId });
      if (isDemo) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
        catch { throw new Error('Не удалось сохранить данные на устройстве. Проверьте свободное место и доступ к хранилищу.'); }
        if (command.type === 'reset') { localStorage.setItem('tiyn.sample', 'false'); setSample(false); }
      }
      accept(next); pending.current.delete(signature);
      if (next.settings.haptics) telegram()?.HapticFeedback?.notificationOccurred('success');
    } finally { active.current = false; setBusy(false); }
  }, [accept]);
  const resetDemo = useCallback(async () => {
    if (!isDemo) return;
    const next = demoBook(); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); localStorage.setItem('tiyn.sample', 'true'); setSample(true); accept(next);
  }, [accept]);
  return { book, error, busy, sample, mutate, reload, resetDemo };
}
