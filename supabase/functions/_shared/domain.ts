import { z } from 'zod';

export const id = () => crypto.randomUUID();
const uuid = z.string().uuid();
const money = z.number().int().safe().min(0).max(100_000_000_000_000);
const positive = money.min(1);
const label = z.string().trim().min(1, 'Укажите название').max(120);
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
}, 'Некорректная дата');
const kindSchema = z.enum(['expense', 'income', 'transfer', 'refund', 'adjustment', 'debt_in', 'debt_out']);
export const accountSchema = z.object({
  id: uuid, name: label, opening: money, color: z.string().regex(/^#[0-9a-f]{6}$/i),
  included: z.boolean(), archived: z.boolean(),
});
export const categorySchema = z.object({
  id: uuid, name: label, type: z.enum(['expense', 'income']), icon: z.string().max(40),
  color: z.string().regex(/^#[0-9a-f]{6}$/i), archived: z.boolean(),
});
export const transactionSchema = z.object({
  id: uuid, kind: kindSchema, amount: z.number().int().safe().min(-100_000_000_000_000).max(100_000_000_000_000),
  accountId: uuid, toAccountId: uuid.optional(), categoryId: uuid.optional(), date: dateSchema,
  note: z.string().trim().max(500), debtId: uuid.optional(), debtChange: z.number().int().safe().optional(),
  createdAt: z.string().datetime(),
});
export const scheduleSchema = z.object({
  id: uuid, name: label, kind: z.enum(['expense', 'income', 'debt']), amount: positive,
  accountId: uuid, categoryId: uuid.optional(), debtId: uuid.optional(), dueDate: dateSchema,
  repeat: z.enum(['once', 'monthly']), dayOfMonth: z.number().int().min(1).max(31),
  completed: z.array(z.object({ date: dateSchema, transactionId: uuid })).max(1200), archived: z.boolean(),
});
export const debtSchema = z.object({
  id: uuid, name: label, direction: z.enum(['owe', 'owed']), opening: money,
  dueDate: z.union([dateSchema, z.literal('')]), note: z.string().max(500), archived: z.boolean(),
});
export const budgetSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), amount: money,
  limits: z.array(z.object({ categoryId: uuid, amount: positive })).max(200),
});
export const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80), defaultAccountId: z.union([uuid, z.literal('')]),
  reserve: money, horizon: z.enum(['income', 'month']), theme: z.enum(['dark', 'light', 'auto']),
  hideAmounts: z.boolean(), haptics: z.boolean(), timezone: z.string().max(80).refine((v) => {
    try { new Intl.DateTimeFormat('ru', { timeZone: v }).format(); return true; } catch { return false; }
  }, 'Неизвестный часовой пояс'),
  reminders: z.boolean(), limitAlerts: z.boolean(), weeklyReport: z.boolean(),
  reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
export const bookSchema = z.object({
  schemaVersion: z.literal(1), onboarded: z.boolean(), settings: settingsSchema,
  accounts: z.array(accountSchema).max(100), categories: z.array(categorySchema).max(200),
  transactions: z.array(transactionSchema).max(20000), schedules: z.array(scheduleSchema).max(300),
  debts: z.array(debtSchema).max(500), budgets: z.array(budgetSchema).max(240),
});
export type Account = z.infer<typeof accountSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Debt = z.infer<typeof debtSchema>;
export type Budget = z.infer<typeof budgetSchema>;
export type Book = z.infer<typeof bookSchema>;
export type Settings = Book['settings'];

export function today(timezone = 'Asia/Almaty', now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}
export const monthOf = (date: string) => date.slice(0, 7);
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00Z`) - Date.parse(`${a}T12:00Z`)) / 86400000);
export function monthEnd(month: string): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m, 0, 12)).toISOString().slice(0, 10);
}
export function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year, m - 1 + offset, 1, 12)).toISOString().slice(0, 7);
}
export function monthlyDate(month: string, day: number): string {
  return `${month}-${String(Math.min(day, Number(monthEnd(month).slice(-2)))).padStart(2, '0')}`;
}
export function parseMoney(input: string): number {
  const normalized = input.replace(/[\s\u00a0\u202f₸]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('Введите сумму, например 2 500 или 2500,50');
  const [whole, fraction = ''] = normalized.split('.');
  return money.parse(Number(whole) * 100 + Number(fraction.padEnd(2, '0')));
}
export const moneyInput = (minor: number) => (minor / 100).toFixed(minor % 100 ? 2 : 0);
export function formatMoney(minor: number, hidden = false): string {
  return hidden ? '•••• ₸' : `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(minor / 100)} ₸`;
}
export function formatDate(date: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00Z`));
}

const expenseDefinitions = [
  ['Продукты', 'basket', '#b8d18b'], ['Кафе и рестораны', 'coffee', '#dfb980'],
  ['Транспорт', 'car', '#91b6cc'], ['Жильё и счета', 'house', '#a2bba9'],
  ['Связь и подписки', 'wifi', '#b0a1cb'], ['Покупки', 'bag', '#cf9da7'],
  ['Здоровье', 'heart', '#d8a28b'], ['Развлечения', 'play', '#aaa4d5'],
  ['Путешествия', 'plane', '#86bfc1'], ['Подарки', 'gift', '#cebb7e'],
  ['Образование', 'book', '#8eafcb'], ['Проценты и комиссии', 'bank', '#b3aaa0'], ['Другое', 'dots', '#a5aaa4'],
];
export function emptyBook(name = 'Мой бюджет'): Book {
  return {
    schemaVersion: 1, onboarded: false,
    settings: { name, defaultAccountId: '', reserve: 0, horizon: 'month', theme: 'dark', hideAmounts: false, haptics: true, timezone: 'Asia/Almaty', reminders: false, limitAlerts: true, weeklyReport: false, reminderTime: '09:00' },
    accounts: [], transactions: [], schedules: [], debts: [], budgets: [],
    categories: [
      ...expenseDefinitions.map(([name, icon, color]) => ({ id: id(), name, icon, color, type: 'expense' as const, archived: false })),
      ...['Зарплата', 'Подработка', 'Подарки', 'Прочие доходы'].map((name, i) => ({ id: id(), name, icon: ['wallet', 'briefcase', 'gift', 'dots'][i], color: '#b8d18b', type: 'income' as const, archived: false })),
    ],
  };
}

export function accountBalance(book: Book, accountId: string, at = '9999-12-31'): number {
  const account = book.accounts.find(a => a.id === accountId);
  return (account?.opening ?? 0) + book.transactions.filter(t => t.date <= at).reduce((sum, t) => {
    if (t.kind === 'transfer') return sum + (t.toAccountId === accountId ? t.amount : t.accountId === accountId ? -t.amount : 0);
    if (t.accountId !== accountId) return sum;
    return sum + (['income', 'refund', 'debt_in', 'adjustment'].includes(t.kind) ? t.amount : -t.amount);
  }, 0);
}
export function debtBalance(book: Book, debtId: string): number {
  return (book.debts.find(d => d.id === debtId)?.opening ?? 0) + book.transactions.filter(t => t.debtId === debtId).reduce((s, t) => s + (t.debtChange ?? 0), 0);
}
export function expenseTotal(book: Book, from: string, to: string, categoryId?: string): number {
  return book.transactions.filter(t => t.date >= from && t.date <= to && (!categoryId || t.categoryId === categoryId))
    .reduce((s, t) => s + (t.kind === 'expense' ? t.amount : t.kind === 'refund' ? -t.amount : 0), 0);
}
export function incomeTotal(book: Book, from: string, to: string): number {
  return book.transactions.filter(t => t.date >= from && t.date <= to && t.kind === 'income').reduce((s, t) => s + t.amount, 0);
}
export function getBudget(book: Book, month: string): Budget {
  return book.budgets.find(b => b.month === month) ?? { month, amount: 0, limits: [] };
}
export interface Occurrence { key: string; schedule: Schedule; date: string; transactionId?: string }
export function occurrences(book: Book, until: string, includeCompleted = false): Occurrence[] {
  const result: Occurrence[] = [];
  for (const schedule of book.schedules.filter(s => !s.archived)) {
    let cursor = schedule.dueDate;
    let count = 0;
    while (cursor <= until && count++ < 1200) {
      const completed = schedule.completed.find(c => c.date === cursor);
      if (!completed || includeCompleted) result.push({ key: `${schedule.id}:${cursor}`, schedule, date: cursor, transactionId: completed?.transactionId });
      if (schedule.repeat === 'once') break;
      cursor = monthlyDate(shiftMonth(monthOf(cursor), 1), schedule.dayOfMonth);
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
export function allowance(book: Book, date = today(book.settings.timezone)) {
  const end = monthEnd(monthOf(date));
  const upcoming = occurrences(book, addDays(date, 400));
  const nextIncome = upcoming.find(o => o.schedule.kind === 'income' && o.date > date);
  const dueIncome = upcoming.find(o => o.schedule.kind === 'income' && o.date <= date);
  const horizon = book.settings.horizon === 'income' && nextIncome ? addDays(nextIncome.date, -1) : end;
  const balance = book.accounts.filter(a => a.included && !a.archived).reduce((s, a) => s + accountBalance(book, a.id, date), 0);
  const reserved = upcoming.filter(o => o.schedule.kind !== 'income' && o.date <= horizon && book.accounts.some(a => a.id === o.schedule.accountId && a.included && !a.archived))
    .reduce((s, o) => s + o.schedule.amount, 0);
  const days = Math.max(1, daysBetween(date, horizon) + 1);
  const free = balance - reserved - book.settings.reserve;
  return { balance, reserved, reserve: book.settings.reserve, days, free, daily: Math.floor(free / days / 100) * 100, horizon, nextIncome, dueIncome };
}

const transactionInput = transactionSchema.omit({ createdAt: true });
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('onboard'), name: label, accountName: label, opening: money }),
  z.object({ type: z.literal('account.save'), account: accountSchema, makeDefault: z.boolean().optional() }),
  z.object({ type: z.literal('account.correct'), accountId: uuid, balance: money, date: dateSchema, note: z.string().max(500) }),
  z.object({ type: z.literal('category.save'), category: categorySchema }),
  z.object({ type: z.literal('transaction.save'), transaction: transactionInput }),
  z.object({ type: z.literal('transaction.delete'), id: uuid }),
  z.object({ type: z.literal('transaction.restore'), transaction: transactionSchema, completions: z.array(z.object({ scheduleId: uuid, date: dateSchema })) }),
  z.object({ type: z.literal('budget.save'), budget: budgetSchema }),
  z.object({ type: z.literal('settings.update'), settings: settingsSchema.partial() }),
  z.object({ type: z.literal('schedule.save'), schedule: scheduleSchema }),
  z.object({ type: z.literal('schedule.complete'), scheduleId: uuid, dueDate: dateSchema, date: dateSchema, amount: positive, transactionId: uuid.optional() }),
  z.object({ type: z.literal('debt.save'), debt: debtSchema, accountId: uuid.optional(), moveMoney: z.boolean(), date: dateSchema }),
  z.object({ type: z.literal('debt.repay'), debtId: uuid, accountId: uuid, amount: positive, date: dateSchema }),
  z.object({ type: z.literal('reset') }),
]);
export type Command = z.infer<typeof commandSchema>;

function upsert<T extends { id: string }>(items: T[], value: T): T[] {
  return items.some(i => i.id === value.id) ? items.map(i => i.id === value.id ? value : i) : [...items, value];
}
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function activeAccount(book: Book, accountId: string) {
  const a = book.accounts.find(a => a.id === accountId); ensure(a && !a.archived, 'Выберите действующий счёт'); return a;
}
function checkTransaction(book: Book, t: Transaction, date: string) {
  ensure(t.date <= date, 'Будущие операции добавляйте как запланированный платёж');
  ensure(t.amount !== 0 && (t.kind === 'adjustment' || t.amount > 0), 'Сумма должна быть больше нуля');
  activeAccount(book, t.accountId);
  if (t.kind === 'transfer') {
    ensure(t.toAccountId && t.toAccountId !== t.accountId, 'Выберите другой счёт для перевода'); activeAccount(book, t.toAccountId);
  } else ensure(!t.toAccountId, 'Счёт назначения нужен только для перевода');
  if (['expense', 'income', 'refund'].includes(t.kind)) {
    const c = book.categories.find(c => c.id === t.categoryId);
    ensure(c && !c.archived && c.type === (t.kind === 'income' ? 'income' : 'expense'), 'Выберите подходящую категорию');
  }
  if (t.debtId) {
    const debt = book.debts.find(d => d.id === t.debtId); ensure(debt, 'Долг не найден');
    ensure(t.debtChange !== undefined && Math.abs(t.debtChange) === t.amount, 'Некорректное движение по долгу');
    const incoming = (debt.direction === 'owe') === (t.debtChange > 0);
    ensure(t.kind === (incoming ? 'debt_in' : 'debt_out'), 'Неверное направление возврата');
  } else ensure(!t.debtChange && !['debt_in', 'debt_out'].includes(t.kind), 'Укажите долг');
}

export function validateBook(input: unknown): Book {
  const book = bookSchema.parse(input);
  for (const collection of [book.accounts, book.categories, book.transactions, book.schedules, book.debts]) {
    ensure(new Set(collection.map(i => i.id)).size === collection.length, 'Повторяющийся идентификатор');
  }
  for (const debt of book.debts) ensure(debtBalance(book, debt.id) >= 0, 'Сумма возврата больше остатка долга');
  if (book.settings.defaultAccountId) ensure(book.accounts.some(a => a.id === book.settings.defaultAccountId && !a.archived), 'Основной счёт недоступен');
  return book;
}

export function applyCommand(input: Book, raw: unknown, now = new Date()): Book {
  const command = commandSchema.parse(raw);
  let book = structuredClone(input);
  const date = today(book.settings.timezone, now);
  const newTransaction = (fields: z.infer<typeof transactionInput>): Transaction => ({ ...fields, createdAt: now.toISOString() });
  const saveTransaction = (t: Transaction) => { checkTransaction(book, t, date); book.transactions = upsert(book.transactions, t); };
  switch (command.type) {
    case 'onboard': {
      ensure(!book.onboarded, 'Первоначальная настройка уже завершена');
      const account: Account = { id: id(), name: command.accountName, opening: command.opening, color: '#b8d18b', included: true, archived: false };
      book.accounts.push(account); book.settings.name = command.name; book.settings.defaultAccountId = account.id; book.onboarded = true; break;
    }
    case 'account.save': {
      const previous = book.accounts.find(a => a.id === command.account.id);
      if (previous) {
        ensure(previous.opening === command.account.opening, 'Для изменения остатка используйте корректировку');
        if (command.account.archived) ensure(!book.schedules.some(s => !s.archived && s.accountId === previous.id), 'Сначала перенесите или архивируйте платежи этого счёта');
      }
      book.accounts = upsert(book.accounts, command.account);
      if (!book.settings.defaultAccountId || (command.account.archived && book.settings.defaultAccountId === command.account.id)) book.settings.defaultAccountId = book.accounts.find(a => !a.archived)?.id ?? '';
      if (command.makeDefault) {
        ensure(!command.account.archived, 'Основной счёт недоступен');
        book.settings.defaultAccountId = command.account.id;
      }
      break;
    }
    case 'account.correct': {
      activeAccount(book, command.accountId);
      const delta = command.balance - accountBalance(book, command.accountId, command.date);
      if (delta) saveTransaction(newTransaction({ id: id(), kind: 'adjustment', accountId: command.accountId, amount: delta, date: command.date, note: command.note || 'Корректировка остатка' }));
      break;
    }
    case 'category.save': {
      const previous = book.categories.find(c => c.id === command.category.id);
      if (previous) ensure(previous.type === command.category.type, 'Тип существующей категории менять нельзя');
      if (command.category.archived) ensure(!book.schedules.some(s => !s.archived && s.categoryId === command.category.id), 'Сначала перенесите или архивируйте планы этой категории');
      book.categories = upsert(book.categories, command.category); break;
    }
    case 'transaction.save': {
      const previous = book.transactions.find(t => t.id === command.transaction.id);
      ensure(!previous?.debtId && !['debt_in', 'debt_out', 'adjustment'].includes(command.transaction.kind), 'Движения по долгу и корректировки создаются в соответствующем разделе');
      const t = newTransaction(command.transaction);
      if (previous) t.createdAt = previous.createdAt;
      for (const s of book.schedules) if (s.completed.some(c => c.transactionId === t.id)) ensure(t.kind === s.kind, 'Тип связанной операции менять нельзя');
      saveTransaction(t); break;
    }
    case 'transaction.delete':
      book.transactions = book.transactions.filter(t => t.id !== command.id);
      book.schedules.forEach(s => { s.completed = s.completed.filter(c => c.transactionId !== command.id); }); break;
    case 'transaction.restore':
      ensure(!book.transactions.some(t => t.id === command.transaction.id), 'Операция уже восстановлена');
      saveTransaction(command.transaction);
      command.completions.forEach(c => {
        const s = book.schedules.find(s => s.id === c.scheduleId); ensure(s, 'Платёж не найден');
        ensure(!s.completed.some(done => done.date === c.date), 'Этот платёж уже оплачен');
        s.completed.push({ date: c.date, transactionId: command.transaction.id });
      }); break;
    case 'budget.save': {
      ensure(new Set(command.budget.limits.map(l => l.categoryId)).size === command.budget.limits.length, 'Лимит категории указан дважды');
      command.budget.limits.forEach(l => ensure(book.categories.some(c => c.id === l.categoryId && c.type === 'expense'), 'Категория лимита не найдена'));
      book.budgets = [...book.budgets.filter(b => b.month !== command.budget.month), command.budget]; break;
    }
    case 'settings.update': book.settings = { ...book.settings, ...command.settings }; break;
    case 'schedule.save': {
      const s = command.schedule; activeAccount(book, s.accountId);
      const previous = book.schedules.find(existing => existing.id === s.id);
      ensure(!previous?.completed.length || (previous.dueDate === s.dueDate && previous.repeat === s.repeat && previous.kind === s.kind), 'У оплаченного плана нельзя менять дату начала, повторение или тип');
      if (s.kind === 'debt') ensure(book.debts.some(d => d.id === s.debtId && d.direction === 'owe'), 'Выберите долг, который нужно вернуть');
      else ensure(book.categories.some(c => c.id === s.categoryId && !c.archived && c.type === s.kind), 'Выберите категорию платежа');
      book.schedules = upsert(book.schedules, { ...s, completed: previous?.completed ?? [] }); break;
    }
    case 'schedule.complete': {
      const s = book.schedules.find(s => s.id === command.scheduleId && !s.archived); ensure(s, 'Платёж не найден');
      ensure(occurrences(book, command.dueDate).some(o => o.schedule.id === s.id && o.date === command.dueDate), 'Платёж уже обработан или дата не входит в график');
      let t: Transaction;
      if (command.transactionId) {
        const existing = book.transactions.find(t => t.id === command.transactionId);
        const expectedKind = s.kind === 'debt' ? 'debt_out' : s.kind;
        ensure(existing && existing.kind === expectedKind && (s.kind !== 'debt' || existing.debtId === s.debtId), 'Выберите операцию подходящего типа');
        ensure(!book.schedules.some(sch => sch.completed.some(c => c.transactionId === existing.id)), 'Операция уже связана с другим платежом');
        t = existing;
      } else {
        t = newTransaction({ id: id(), kind: s.kind === 'debt' ? 'debt_out' : s.kind, amount: command.amount, accountId: s.accountId, categoryId: s.categoryId, date: command.date, note: s.name, ...(s.kind === 'debt' ? { debtId: s.debtId, debtChange: -command.amount } : {}) });
        saveTransaction(t);
      }
      s.completed.push({ date: command.dueDate, transactionId: t.id }); break;
    }
    case 'debt.save': {
      const previous = book.debts.find(d => d.id === command.debt.id);
      if (previous) ensure(previous.opening === command.debt.opening && previous.direction === command.debt.direction, 'Начальный остаток и направление существующего долга менять нельзя');
      ensure(!previous || !command.moveMoney, 'Для существующего долга нельзя повторно записать выдачу');
      const debt = { ...command.debt, opening: command.moveMoney ? 0 : command.debt.opening };
      book.debts = upsert(book.debts, debt);
      if (debt.archived) {
        ensure(debtBalance(book, debt.id) === 0, 'Сначала закройте долг');
        ensure(!book.schedules.some(s => !s.archived && s.debtId === debt.id), 'Сначала архивируйте планы возврата долга');
      }
      if (command.moveMoney) {
        ensure(command.accountId && command.debt.opening > 0, 'Выберите счёт и сумму');
        saveTransaction(newTransaction({ id: id(), kind: debt.direction === 'owe' ? 'debt_in' : 'debt_out', amount: command.debt.opening, accountId: command.accountId, date: command.date, note: `Займ: ${debt.name}`, debtId: debt.id, debtChange: command.debt.opening }));
      }
      break;
    }
    case 'debt.repay': {
      const debt = book.debts.find(d => d.id === command.debtId); ensure(debt && !debt.archived, 'Долг не найден');
      saveTransaction(newTransaction({ id: id(), kind: debt.direction === 'owe' ? 'debt_out' : 'debt_in', amount: command.amount, accountId: command.accountId, date: command.date, note: `Возврат: ${debt.name}`, debtId: debt.id, debtChange: -command.amount })); break;
    }
    case 'reset': book = emptyBook(book.settings.name); book.settings.timezone = input.settings.timezone; book.settings.theme = input.settings.theme; break;
  }
  return validateBook(book);
}

export function exportCsv(book: Book, from: string, to: string): string {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`;
  const types: Record<Transaction['kind'], string> = { expense: 'Расход', income: 'Доход', transfer: 'Перевод', refund: 'Возврат покупки', adjustment: 'Корректировка', debt_in: 'Долг: поступление', debt_out: 'Долг: списание' };
  const rows = [['Дата', 'Тип', 'Сумма', 'Валюта', 'Категория', 'Счёт', 'Счёт назначения', 'Комментарий'],
    ...book.transactions.filter(t => t.date >= from && t.date <= to).sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, types[t.kind], moneyInput(t.amount).replace('.', ','), 'KZT', book.categories.find(c => c.id === t.categoryId)?.name ?? '', book.accounts.find(a => a.id === t.accountId)?.name ?? '', book.accounts.find(a => a.id === t.toAccountId)?.name ?? '', t.note])];
  return '\ufeff' + rows.map(row => row.map(escape).join(';')).join('\r\n');
}
