import { useCallback, useEffect, useState } from 'react';
import { AppContext, type Filters, type Modal, type Page } from './context';
import { useBook, isDemo } from './store';
import { initializeTelegram, telegram } from './telegram';
import { Icon, IconButton, Sheet } from './components';
import { HomePage, OperationsPage, BudgetPage, AnalyticsPage } from './pages';
import { AccountForm, AccountsList, AllowanceForm, BotForm, BudgetForm, CategoryForm, CategoryList, CompleteForm, CorrectForm, DebtForm, DebtsList, DemoResetForm, ExportForm, OnboardForm, RepayForm, ResetForm, ScheduleForm, SettingsForm, TransactionForm } from './forms';
import { monthOf, today, type Command, type Transaction } from '../supabase/functions/_shared/domain.ts';

const navigation: { page: Page; title: string; icon: string }[] = [
  { page: 'home', title: 'Главная', icon: 'home' }, { page: 'operations', title: 'Операции', icon: 'list' },
  { page: 'budget', title: 'Бюджет', icon: 'wallet' }, { page: 'analytics', title: 'Аналитика', icon: 'chart' },
];
const titles: Record<Modal['type'], string> = {
  transaction: 'Операция', accounts: 'Мои счета', account: 'Счёт', correct: 'Корректировка остатка',
  settings: 'Настройки', budget: 'Настроить бюджет', category: 'Категория', categories: 'Категории',
  schedule: 'Запланированное событие', complete: 'Подтвердить событие', debts: 'Долги', debt: 'Карточка долга', repay: 'Возврат долга',
  allowance: 'Ваш ориентир на день', onboard: 'Начнём с вашего счёта', reset: 'Удалить данные', demoReset: 'Загрузить пример', bot: 'Быстрый ввод', export: 'Экспорт операций',
};
function currentPage(): Page { return navigation.find(n => `#${n.page}` === window.location.hash)?.page ?? 'home'; }
export function App() {
  const { book, error, busy, sample, mutate, reload, resetDemo } = useBook();
  const [page, setPage] = useState<Page>(currentPage);
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'info' | 'success' | 'error'; undo?: () => Promise<void> } | null>(null);
  const [month, setMonth] = useState(monthOf(today()));
  const [clock, setClock] = useState(new Date());
  const [filters, updateFilters] = useState<Filters>({ from: `${monthOf(today())}-01`, to: today(), kind: 'all', categoryId: '', accountId: '', search: '' });
  const close = useCallback(() => setModal(null), []);
  const notify = useCallback((message: string, tone: 'info' | 'success' | 'error' = 'info') => setToast({ message, tone }), []);
  const navigate = useCallback((next: Page) => { window.location.hash = next; setPage(next); window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  const setFilters = useCallback((next: Partial<Filters>) => updateFilters(previous => ({ ...previous, ...next })), []);
  const run = useCallback(async (command: Command, message?: string) => { await mutate(command); if (message) notify(message, 'success'); }, [mutate, notify]);
  const perform = useCallback((command: Command, message?: string) => { void run(command, message).catch(e => notify(e.message, 'error')); }, [run, notify]);
  const removeTransaction = useCallback(async (transaction: Transaction) => {
    if (!book) return;
    const completions = book.schedules.flatMap(s => s.completed.filter(c => c.transactionId === transaction.id).map(c => ({ scheduleId: s.id, date: c.date })));
    await mutate({ type: 'transaction.delete', id: transaction.id });
    setToast({ message: 'Операция удалена', undo: async () => { await mutate({ type: 'transaction.restore', transaction, completions }); notify('Операция восстановлена'); } });
  }, [book, mutate, notify]);
  useEffect(initializeTelegram, []);
  useEffect(() => { const hash = () => setPage(currentPage()); window.addEventListener('hashchange', hash); return () => window.removeEventListener('hashchange', hash); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  useEffect(() => {
    if (!book) return;
    const txId = new URLSearchParams(window.location.search).get('edit');
    if (txId && book.transactions.some(t => t.id === txId)) {
      setModal({ type: 'transaction', id: txId });
      const url = new URL(window.location.href); url.searchParams.delete('edit'); window.history.replaceState(null, '', url);
    }
  }, [book]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 12000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const mode = book?.settings.theme ?? 'dark'; const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = mode === 'auto' ? (telegram()?.initData ? telegram()!.colorScheme : query.matches ? 'dark' : 'light') : mode;
      document.documentElement.dataset.theme = theme;
      if (telegram()?.initData) { telegram()!.setHeaderColor(theme === 'dark' ? '#141611' : '#f5f5ef'); telegram()!.setBackgroundColor(theme === 'dark' ? '#141611' : '#f5f5ef'); }
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#141611' : '#f5f5ef');
    };
    update(); query.addEventListener('change', update); telegram()?.onEvent('themeChanged', update);
    return () => { query.removeEventListener('change', update); telegram()?.offEvent('themeChanged', update); };
  }, [book?.settings.theme]);
  if (!book) return <div className="loading-screen"><div className="brand"><span className="brand-mark">t</span><span>tiyn<span className="brand-period">.</span></span></div>{error ? <><Icon name="warning" size={34} /><h1>Бюджет пока недоступен</h1><p>{error}</p><button className="button primary" onClick={() => void reload()}>Попробовать снова</button>{import.meta.env.VITE_TELEGRAM_BOT_USERNAME && <a className="text-button" href={`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME.replace('@', '')}`}>Открыть бота<Icon name="telegram" /></a>}</> : <><div className="skeleton" /><div className="skeleton short" /><p className="muted">Загружаем ваш бюджет</p></>}</div>;
  const date = today(book.settings.timezone, clock);
  return <AppContext.Provider value={{ book, busy, date, page, month, setMonth, filters, setFilters, open: setModal, close, navigate, run, perform, notify, removeTransaction, resetDemo }}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>К содержимому</a>
    <div className="app-main" data-page={page}>
      <header className="app-header">
        <a className="brand" href="#home" aria-label="Tiyn, главная"><span className="brand-mark">t</span><span>tiyn<span className="brand-period">.</span></span></a>
        <nav className="desktop-nav" aria-label="Основная навигация">{navigation.map(n => <a key={n.page} href={`#${n.page}`} aria-current={page === n.page ? 'page' : undefined} className={page === n.page ? 'active' : ''}><Icon name={n.icon} size={18} /><span>{n.title}</span></a>)}</nav>
        <div className="header-actions">
          {isDemo && <span className="mode-badge">Локально</span>}
          {page !== 'home' && <IconButton icon={book.settings.hideAmounts ? 'hidden' : 'eye'} label="Скрыть или показать суммы" onClick={() => perform({ type: 'settings.update', settings: { hideAmounts: !book.settings.hideAmounts } })} />}
          <button className="header-bot icon-button" aria-label="Быстрый ввод" onClick={() => setModal({ type: 'bot' })}><Icon name="telegram" /></button>
          {book.onboarded && <button className="button primary header-add" onClick={() => setModal({ type: 'transaction' })}><Icon name="plus" size={18} /><span>Записать</span></button>}
          <button className="profile-button" aria-label="Открыть настройки" onClick={() => setModal({ type: 'settings' })}><Icon name="settings" size={21} /></button>
        </div>
      </header>
      <main id="main-content" className="content" tabIndex={-1}>
        {isDemo && <div className="demo-banner"><span><Icon name="info" size={15} />{sample ? 'Демо-бюджет · на этом устройстве' : 'Данные на этом устройстве'}</span>{book.onboarded && sample && <button onClick={() => setModal({ type: 'onboard' })}>Создать свой<Icon name="arrow" size={14} /></button>}</div>}
        {error && <div className="form-error" role="alert">{error}<button className="text-button" onClick={() => void reload()}>Повторить</button></div>}
        {!book.onboarded ? <section className="welcome"><span className="welcome-symbol"><Icon name="wallet" size={50} /></span><p className="eyebrow">Ваши финансы начинаются здесь</p><h1>Чуть больше ясности.<br />Каждый день.</h1><p>Записывайте расходы, планируйте платежи и знайте, сколько можно потратить сегодня.</p><button className="button primary" onClick={() => setModal({ type: 'onboard' })}>Настроить мой бюджет<Icon name="arrow" /></button><small>Первый счёт и текущий остаток. Всё остальное позже.</small></section> : page === 'home' ? <HomePage /> : page === 'operations' ? <OperationsPage /> : page === 'budget' ? <BudgetPage /> : <AnalyticsPage />}
        <footer className="app-footer"><span>tiyn.</span><p>Личный бюджет · KZT</p><button className="text-button" onClick={() => setModal({ type: 'settings' })}>Настройки<Icon name="right" size={14} /></button></footer>
      </main>
    </div>
    {book.onboarded && <nav className="bottom-nav" aria-label="Мобильная навигация">
      {navigation.slice(0, 2).map(n => <a key={n.page} href={`#${n.page}`} className={page === n.page ? 'active' : ''} aria-current={page === n.page ? 'page' : undefined}><Icon name={n.icon} size={22} /><span>{n.title}</span></a>)}
      <button className="nav-add" aria-label="Добавить операцию" onClick={() => setModal({ type: 'transaction' })}><span><Icon name="plus" size={25} /></span><small>Записать</small></button>
      {navigation.slice(2).map(n => <a key={n.page} href={`#${n.page}`} className={page === n.page ? 'active' : ''} aria-current={page === n.page ? 'page' : undefined}><Icon name={n.icon} size={22} /><span>{n.title}</span></a>)}
    </nav>}
    {modal && <Sheet key={`${modal.type}:${modal.id ?? modal.draft?.id ?? ''}`} title={titles[modal.type]} onClose={close}><ModalContent modal={modal} /></Sheet>}
    {toast && <div className={`toast ${toast.tone ?? 'info'}`} role="status"><Icon name={toast.tone === 'error' ? 'warning' : toast.tone === 'success' ? 'success' : 'info'} /><span>{toast.message}</span>{toast.undo && <button disabled={busy} onClick={() => void toast.undo!().catch(e => notify(e.message, 'error'))}>Отменить</button>}<IconButton icon="close" label="Скрыть уведомление" onClick={() => setToast(null)} /></div>}
  </AppContext.Provider>;
}
function ModalContent({ modal }: { modal: Modal }) {
  switch (modal.type) {
    case 'transaction': return <TransactionForm modal={modal} />;
    case 'accounts': return <AccountsList />;
    case 'account': return <AccountForm accountId={modal.id} />;
    case 'correct': return <CorrectForm accountId={modal.id!} />;
    case 'settings': return <SettingsForm />;
    case 'budget': return <BudgetForm />;
    case 'category': return <CategoryForm categoryId={modal.id} />;
    case 'categories': return <CategoryList />;
    case 'schedule': return <ScheduleForm scheduleId={modal.id} />;
    case 'complete': return <CompleteForm modal={modal} />;
    case 'debts': return <DebtsList />;
    case 'debt': return <DebtForm debtId={modal.id} />;
    case 'repay': return <RepayForm debtId={modal.id!} />;
    case 'allowance': return <AllowanceForm />;
    case 'onboard': return <OnboardForm />;
    case 'reset': return <ResetForm />;
    case 'demoReset': return <DemoResetForm />;
    case 'bot': return <BotForm />;
    case 'export': return <ExportForm />;
  }
}
