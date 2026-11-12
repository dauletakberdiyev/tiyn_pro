import { describe, expect, it } from 'vitest';
import { accountBalance, addDays, allowance, applyCommand, debtBalance, emptyBook, expenseTotal, exportCsv, getBudget, id, incomeTotal, monthlyDate, occurrences, parseMoney, today, type Book, type Command, type Schedule, type Transaction } from '../supabase/functions/_shared/domain.ts';
import { parseText } from '../supabase/functions/_shared/parser.ts';
import { notifications } from '../supabase/functions/_shared/notifications.ts';
import { constantTimeEqual, hmac, verifyInitData } from '../supabase/functions/_shared/telegram-auth.ts';

const now = new Date('2026-11-12T07:00:00.000Z');
function fixture() {
  let book = applyCommand(emptyBook(), { type: 'onboard', name: 'Личный бюджет', accountName: 'Kaspi', opening: 18000000 }, now);
  book = applyCommand(book, { type: 'account.save', account: { id: id(), name: 'Накопления', opening: 50000000, color: '#b8d18b', included: false, archived: false } }, now);
  return book;
}
const apply = (book: Book, command: Command) => applyCommand(book, command, now);
function transaction(book: Book, kind: Transaction['kind'], amount: number, extra: Partial<Transaction> = {}) {
  const t = { id: id(), kind, amount, accountId: book.accounts[0].id, categoryId: book.categories.find(c => c.type === (kind === 'income' ? 'income' : 'expense'))!.id, date: '2026-11-12', note: '', ...extra };
  return apply(book, { type: 'transaction.save', transaction: t });
}
function schedule(book: Book, extra: Partial<Schedule> = {}): Schedule {
  return { id: id(), name: 'Аренда', kind: 'expense', amount: 6000000, accountId: book.accounts[0].id, categoryId: book.categories[0].id, dueDate: '2026-11-20', repeat: 'once', dayOfMonth: 20, completed: [], archived: false, ...extra };
}

describe('Деньги и даты', () => {
  it('разбирает суммы без потери тиынов', () => {
    expect(parseMoney('1 234,56')).toBe(123456); expect(parseMoney('0.01')).toBe(1); expect(parseMoney('25\u202f000 ₸')).toBe(2500000);
  });
  it('отклоняет неоднозначные и чрезмерные суммы', () => {
    for (const input of ['-1', '1.001', '1e5', '1,2,3', '99999999999999999']) expect(() => parseMoney(input)).toThrow();
  });
  it('сохраняет исходный день при ежемесячном переносе', () => {
    expect(monthlyDate('2027-02', 31)).toBe('2027-02-28'); expect(monthlyDate('2028-02', 31)).toBe('2028-02-29'); expect(monthlyDate('2027-03', 31)).toBe('2027-03-31');
  });
  it('считает пользовательский день в часовом поясе', () => {
    expect(today('Asia/Almaty', new Date('2026-11-11T20:01Z'))).toBe('2026-11-12'); expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('Остатки и отчёты', () => {
  it('сохраняет счёт и выбор основного одной командой, не меняя остатки', () => {
    const book = fixture(); const account = book.accounts[1];
    const next = apply(book, { type: 'account.save', account: { ...account, name: 'Резерв' }, makeDefault: true });
    expect(next.settings.defaultAccountId).toBe(account.id);
    expect(next.accounts[1].name).toBe('Резерв');
    expect(next.transactions).toEqual(book.transactions);
    expect(accountBalance(next, account.id)).toBe(accountBalance(book, account.id));
    expect(() => apply(book, { type: 'account.save', account: { ...account, archived: true }, makeDefault: true })).toThrow('Основной счёт недоступен');
  });
  it('начальный остаток не является доходом', () => {
    const b = fixture(); expect(accountBalance(b, b.accounts[0].id)).toBe(18000000); expect(incomeTotal(b, '2026-11-01', '2026-11-30')).toBe(0);
  });
  it('перевод меняет два счёта без создания доходов и расходов', () => {
    const b = fixture(); const next = transaction(b, 'transfer', 1000000, { categoryId: undefined, toAccountId: b.accounts[1].id });
    expect(accountBalance(next, b.accounts[0].id)).toBe(17000000); expect(accountBalance(next, b.accounts[1].id)).toBe(51000000);
    expect(expenseTotal(next, '2026-01-01', '2026-12-31')).toBe(0); expect(incomeTotal(next, '2026-01-01', '2026-12-31')).toBe(0);
  });
  it('возврат уменьшает расходы, не становясь доходом', () => {
    const b = transaction(transaction(fixture(), 'expense', 500000), 'refund', 200000);
    expect(expenseTotal(b, '2026-11-01', '2026-11-30')).toBe(300000); expect(incomeTotal(b, '2026-11-01', '2026-11-30')).toBe(0);
  });
  it('редактирование не задваивает запись, удаление и восстановление возвращают остаток', () => {
    let b = transaction(fixture(), 'expense', 100000); const t = b.transactions[0];
    b = apply(b, { type: 'transaction.save', transaction: { ...t, amount: 200000 } }); expect(b.transactions).toHaveLength(1);
    const updated = b.transactions[0]; b = apply(b, { type: 'transaction.delete', id: t.id }); expect(accountBalance(b, b.accounts[0].id)).toBe(18000000);
    b = apply(b, { type: 'transaction.restore', transaction: updated, completions: [] }); expect(accountBalance(b, b.accounts[0].id)).toBe(17800000);
  });
  it('корректировка сверяет остаток, сохраняя расходы и доходы', () => {
    let b = transaction(fixture(), 'expense', 500000);
    b = apply(b, { type: 'account.correct', accountId: b.accounts[0].id, balance: 16000000, date: '2026-11-12', note: 'Сверка' });
    expect(accountBalance(b, b.accounts[0].id)).toBe(16000000); expect(expenseTotal(b, '2026-11-01', '2026-11-30')).toBe(500000);
    expect(b.transactions[1].amount).toBe(-1500000);
  });
  it('не разрешает будущую трату, перевод в тот же счёт и подмену корректировки', () => {
    const b = fixture(); expect(() => transaction(b, 'expense', 100, { date: '2026-11-13' })).toThrow();
    expect(() => transaction(b, 'transfer', 100, { toAccountId: b.accounts[0].id })).toThrow();
    expect(() => transaction(b, 'adjustment', -100)).toThrow();
  });
  it('экспорт защищает текст от исполнения формул в таблицах', () => {
    const b = transaction(fixture(), 'expense', 120050, { note: '=HYPERLINK("evil")' }); const csv = exportCsv(b, '2026-11-01', '2026-11-30');
    expect(csv).toContain('"1200,50"'); expect(csv).toContain('"\'=HYPERLINK(""evil"")"'); expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('Планы и сумма на день', () => {
  it('исключает накопления и ожидаемый доход, учитывает платежи и резерв', () => {
    let b = fixture(); b.schedules = [schedule(b), schedule(b, { id: id(), kind: 'income', amount: 99900000, categoryId: b.categories.find(c => c.type === 'income')!.id, dueDate: '2026-11-22' })];
    b.settings.reserve = 5000000; b.settings.horizon = 'income';
    const a = allowance(b, '2026-11-12'); expect(a.balance).toBe(18000000); expect(a.days).toBe(10); expect(a.daily).toBe(700000);
  });
  it('не резервирует платежи с исключённого накопительного счёта', () => {
    const b = fixture(); b.schedules = [schedule(b, { accountId: b.accounts[1].id })]; expect(allowance(b, '2026-11-12').reserved).toBe(0);
  });
  it('включает просроченные обязательства и показывает дефицит', () => {
    const b = fixture(); b.schedules = [schedule(b, { dueDate: '2026-11-01', amount: 20000000 })];
    expect(allowance(b, '2026-11-12').free).toBe(-2000000);
  });
  it('оплаченный план не вычитает деньги дважды; удаление оплаты открывает план', () => {
    let b = fixture(); const s = schedule(b); b.schedules = [s]; const before = allowance(b, '2026-11-12').free;
    b = apply(b, { type: 'schedule.complete', scheduleId: s.id, dueDate: s.dueDate, date: '2026-11-12', amount: s.amount });
    expect(allowance(b, '2026-11-12').free).toBe(before); expect(allowance(b, '2026-11-12').reserved).toBe(0);
    expect(() => apply(b, { type: 'schedule.complete', scheduleId: s.id, dueDate: s.dueDate, date: '2026-11-12', amount: s.amount })).toThrow();
    b = apply(b, { type: 'transaction.delete', id: b.transactions[0].id }); expect(occurrences(b, '2026-11-30')).toHaveLength(1);
  });
  it('связывает уже записанную операцию без дублирования', () => {
    let b = transaction(fixture(), 'expense', 500000); const s = schedule(b); b.schedules = [s];
    b = apply(b, { type: 'schedule.complete', scheduleId: s.id, dueDate: s.dueDate, amount: s.amount, date: '2026-11-12', transactionId: b.transactions[0].id });
    expect(b.transactions).toHaveLength(1); expect(b.schedules[0].completed).toHaveLength(1);
  });
  it('при отсутствии будущего дохода использует конец месяца, без деления на ноль', () => {
    const b = fixture(); b.settings.horizon = 'income';
    expect(allowance(b, '2026-11-30').days).toBe(1); expect(allowance(b, '2026-11-30').horizon).toBe('2026-11-30');
  });
  it('показывает доход на сегодня как ожидающий подтверждения', () => {
    const b = fixture(); b.schedules = [schedule(b, { kind: 'income', dueDate: '2026-11-12' })];
    const a = allowance(b, '2026-11-12'); expect(a.dueIncome).toBeDefined(); expect(a.balance).toBe(18000000);
  });
  it('генерирует ежемесячные события по исходному числу', () => {
    const b = fixture(); b.schedules = [schedule(b, { dueDate: '2027-01-31', repeat: 'monthly', dayOfMonth: 31 })];
    expect(occurrences(b, '2027-03-31').map(o => o.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
  });
  it('бюджет не меняет деньги; повторные лимиты запрещены', () => {
    const b = fixture(); const budget = { month: '2026-11', amount: 99999999, limits: [] };
    const next = apply(b, { type: 'budget.save', budget }); expect(accountBalance(next, next.accounts[0].id)).toBe(18000000); expect(getBudget(next, '2026-11')).toEqual(budget);
    expect(() => apply(b, { type: 'budget.save', budget: { ...budget, limits: [{ categoryId: b.categories[0].id, amount: 100 }, { categoryId: b.categories[0].id, amount: 200 }] } })).toThrow();
  });
});

describe('Долги', () => {
  it('старый долг не меняет счёт; частичный возврат меняет оба остатка', () => {
    let b = fixture(); const debtId = id();
    b = apply(b, { type: 'debt.save', debt: { id: debtId, name: 'Алексей', direction: 'owe', opening: 2000000, dueDate: '', note: '', archived: false }, moveMoney: false, date: '2026-11-12' });
    expect(accountBalance(b, b.accounts[0].id)).toBe(18000000);
    b = apply(b, { type: 'debt.repay', debtId, accountId: b.accounts[0].id, amount: 500000, date: '2026-11-12' });
    expect(debtBalance(b, debtId)).toBe(1500000); expect(accountBalance(b, b.accounts[0].id)).toBe(17500000); expect(expenseTotal(b, '2026-11-01', '2026-11-30')).toBe(0);
    expect(() => apply(b, { type: 'debt.repay', debtId, accountId: b.accounts[0].id, amount: 2000000, date: '2026-11-12' })).toThrow();
  });
  it('выданный новый заём и его возврат не становятся расходом и доходом', () => {
    let b = fixture(); const debtId = id();
    b = apply(b, { type: 'debt.save', debt: { id: debtId, name: 'Друг', direction: 'owed', opening: 500000, dueDate: '', note: '', archived: false }, moveMoney: true, accountId: b.accounts[0].id, date: '2026-11-12' });
    expect(debtBalance(b, debtId)).toBe(500000); expect(accountBalance(b, b.accounts[0].id)).toBe(17500000);
    b = apply(b, { type: 'debt.repay', debtId, accountId: b.accounts[0].id, amount: 500000, date: '2026-11-12' });
    expect(debtBalance(b, debtId)).toBe(0); expect(accountBalance(b, b.accounts[0].id)).toBe(18000000); expect(incomeTotal(b, '2026-01-01', '2026-12-31')).toBe(0);
  });
});

describe('Текстовый ввод', () => {
  it('понимает кофе, дату вчера и доход зарплаты', () => {
    const b = fixture(); const coffee = parseText('кофе 1800', b, '2026-11-12');
    expect(coffee.draft.amount).toBe(180000); expect(b.categories.find(c => c.id === coffee.draft.categoryId)?.name).toBe('Кафе и рестораны');
    expect(parseText('такси 2 500 вчера', b, '2026-11-12').draft.date).toBe('2026-11-11');
    expect(parseText('доход 350000 зарплата', b, '2026-11-12').draft.kind).toBe('income');
  });
  it('не придумывает неоднозначную категорию и отклоняет две суммы', () => {
    const b = fixture(); expect(parseText('непонятное 1234', b, '2026-11-12').needsCategory).toBe(true);
    expect(() => parseText('кофе 1800 и такси 2000', b, '2026-11-12')).toThrow();
  });
});

describe('Уведомления', () => {
  it('учитывает локальное время и формирует стабильные ключи порогов', () => {
    let b = fixture(); b.settings.limitAlerts = true; b.settings.reminderTime = '09:00';
    b = transaction(b, 'expense', 90000); b.budgets = [{ month: '2026-11', amount: 0, limits: [{ categoryId: b.categories[0].id, amount: 100000 }] }];
    expect(notifications(b, new Date('2026-11-12T03:00Z'))).toHaveLength(0);
    const jobs = notifications(b, now); expect(jobs).toHaveLength(1); expect(jobs[0].key).toContain(':80');
    expect(notifications(b, new Date('2026-11-12T08:00Z'))[0].key).toBe(jobs[0].key);
  });
});

describe('Подпись Telegram', () => {
  async function signed() {
    const token = '123456:test-secret';
    const params = new URLSearchParams({ auth_date: String(Math.floor(+now / 1000)), user: JSON.stringify({ id: 123, first_name: 'Данияр' }) });
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = await hmac(new TextEncoder().encode('WebAppData'), token);
    params.set('hash', [...await hmac(secret, check)].map(b => b.toString(16).padStart(2, '0')).join(''));
    return { params, token };
  }
  it('принимает подписанные данные и отклоняет подмену пользователя', async () => {
    const { params, token } = await signed(); expect((await verifyInitData(params.toString(), token, +now)).id).toBe(123);
    params.set('user', JSON.stringify({ id: 999, first_name: 'Другой' })); await expect(verifyInitData(params.toString(), token, +now)).rejects.toThrow();
  });
  it('отклоняет старую сессию и повторяющиеся ключи', async () => {
    const { params, token } = await signed(); await expect(verifyInitData(params.toString(), token, +now + 901000)).rejects.toThrow();
    params.append('auth_date', params.get('auth_date')!); await expect(verifyInitData(params.toString(), token, +now)).rejects.toThrow();
  });
  it('сравнение секретов учитывает длину и содержимое', () => {
    expect(constantTimeEqual('secret', 'secret')).toBe(true); expect(constantTimeEqual('secret', 'secre')).toBe(false); expect(constantTimeEqual('secret', 'SECRET')).toBe(false);
  });
});
