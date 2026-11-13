import { describe, expect, it } from 'vitest';
import { accountBalance, allowance, applyCommand, emptyBook, expenseTotal, id, incomeTotal, savingsGoalProgress, validateBook, type Book, type Command, type SavingsGoal } from '../supabase/functions/_shared/domain.ts';
import { parseText } from '../supabase/functions/_shared/parser.ts';

const now = new Date('2026-11-12T07:00:00Z');
const date = '2026-11-12';
const apply = (book: Book, command: Command) => applyCommand(book, command, now);
function fixture() {
  let book = apply(emptyBook(), { type: 'onboard', name: 'Бюджет', accountName: 'Карта', opening: 10000000 });
  book = apply(book, { type: 'account.save', account: { id: id(), name: 'Депозит', opening: 2000000, color: '#b8d18b', included: true, archived: false } });
  const goal: SavingsGoal = { id: id(), name: 'Подушка', targetAmount: 10000000, accountId: book.accounts[1].id, dueDate: '', archived: false };
  return { book, goal };
}
const save = (book: Book, goal: SavingsGoal) => apply(book, { type: 'goal.save', goal });

describe('Цели: данные и ограничения', () => {
  it('читает прежний локальный формат и сохраняет цели после JSON-перезагрузки', () => {
    const { book, goal } = fixture();
    const legacy = JSON.parse(JSON.stringify(book)); delete legacy.goals;
    expect(validateBook(legacy)).toEqual(book);
    const next = save(validateBook(legacy), goal);
    expect(validateBook(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(next.schemaVersion).toBe(1);
    expect(() => validateBook({ ...book, goals: null })).toThrow();
  });
  it('привязывает счёт атомарно, исключая его ровно один раз без финансовой операции', () => {
    const { book, goal } = fixture();
    const next = save(book, goal);
    expect(book.accounts[1].included).toBe(true);
    expect(next.accounts[1].included).toBe(false);
    expect(next.transactions).toEqual(book.transactions);
    expect(next.accounts.map(a => accountBalance(next, a.id))).toEqual(book.accounts.map(a => accountBalance(book, a.id)));
    expect(incomeTotal(next, '2026-01-01', date)).toBe(0);
    expect(expenseTotal(next, '2026-01-01', date)).toBe(0);
    expect(allowance(book, date).balance - allowance(next, date).balance).toBe(2000000);
    const edited = save(next, { ...goal, name: 'Резерв' });
    expect(allowance(edited, date)).toEqual(allowance(next, date));
  });
  it('отклоняет некорректные цели и вторую активную цель на том же счёте', () => {
    const { book, goal } = fixture();
    for (const invalid of [{ ...goal, targetAmount: 0 }, { ...goal, targetAmount: -1 }, { ...goal, name: ' ' }, { ...goal, dueDate: '2027-02-30' }, { ...goal, accountId: id() }]) {
      expect(() => save(book, invalid)).toThrow();
    }
    const next = save(book, goal);
    expect(() => save(next, { ...goal, id: id() })).toThrow('На этом счёте уже есть активная цель');
    expect(() => validateBook({ ...next, goals: [goal, goal] })).toThrow('Повторяющийся идентификатор');
    expect(() => validateBook({ ...next, goals: [goal, { ...goal, id: id() }] })).toThrow('На этом счёте уже есть активная цель');
    expect(() => apply(next, { type: 'account.save', account: { ...next.accounts[1], included: true } })).toThrow('Счёт активной цели');
    expect(() => apply(next, { type: 'account.save', account: { ...next.accounts[1], archived: true } })).toThrow('Сначала перенесите или архивируйте цель');
    expect(() => validateBook({ ...next, accounts: book.accounts })).toThrow('Счёт активной цели');
  });
  it('меняет привязку, оставляя предыдущий счёт накопительным', () => {
    const { book, goal } = fixture();
    const next = save(save(book, goal), { ...goal, accountId: book.accounts[0].id, targetAmount: 20000000, dueDate: '2027-06-01' });
    expect(next.accounts.every(a => !a.included)).toBe(true);
    expect(next.goals).toHaveLength(1);
    expect(savingsGoalProgress(next, next.goals[0], date).balance).toBe(10000000);
    expect(next.transactions).toEqual(book.transactions);
  });
  it('архив освобождает счёт, а восстановление требует действующего свободного счёта', () => {
    const { book, goal } = fixture();
    let next = save(save(book, goal), { ...goal, archived: true });
    expect(next.accounts[1].included).toBe(false);
    const other = { ...goal, id: id(), name: 'Отпуск' };
    next = save(next, other);
    expect(() => save(next, goal)).toThrow('На этом счёте уже есть активная цель');
    next = save(next, { ...other, archived: true });
    next = apply(next, { type: 'account.save', account: { ...next.accounts[1], archived: true } });
    expect(() => save(next, goal)).toThrow('Выберите действующий счёт');
    next = save(next, { ...goal, accountId: next.accounts[0].id });
    expect(next.accounts[0].included).toBe(false);
    expect(savingsGoalProgress(next, next.goals[0], date).balance).toBe(10000000);
    expect(apply(next, { type: 'reset' }).goals).toEqual([]);
  });
});

describe('Прогресс и сроки целей', () => {
  it('обновляется после перевода, процентов через бота, снятия, исправления, удаления и отмены', () => {
    const { book, goal } = fixture();
    let next = save(book, goal);
    const balance = () => savingsGoalProgress(next, goal, date).balance;
    const transferId = id();
    expect(balance()).toBe(2000000);
    next = apply(next, { type: 'transaction.save', transaction: { id: transferId, kind: 'transfer', accountId: book.accounts[0].id, toAccountId: goal.accountId, amount: 500000, date, note: '' } });
    expect(balance()).toBe(2500000);
    const parsed = parseText('доход 1000 депозит', next, date).draft;
    next = apply(next, { type: 'transaction.save', transaction: { ...parsed, categoryId: next.categories.find(c => c.type === 'income')!.id } });
    expect(balance()).toBe(2600000);
    next = apply(next, { type: 'transaction.save', transaction: { id: id(), kind: 'expense', accountId: goal.accountId, categoryId: next.categories[0].id, amount: 200000, date, note: '' } });
    expect(balance()).toBe(2400000);
    next = apply(next, { type: 'transaction.save', transaction: { ...next.transactions.find(t => t.id === transferId)!, amount: 300000 } });
    expect(balance()).toBe(2200000);
    const transfer = next.transactions.find(t => t.id === transferId)!;
    next = apply(next, { type: 'transaction.delete', id: transferId }); expect(balance()).toBe(1900000);
    next = apply(next, { type: 'transaction.restore', transaction: transfer, completions: [] }); expect(balance()).toBe(2200000);
    next = apply(next, { type: 'account.correct', accountId: goal.accountId, balance: 2700000, date, note: '' });
    expect(balance()).toBe(2700000);
    expect(next.goals).toEqual([goal]);
  });
  it.each([
    [0, 0, 10000000, false], [-100000, 0, 10100000, false],
    [9999999, 99, 1, false], [10000000, 100, 0, true], [12000000, 100, 0, true],
  ])('правильно ограничивает процент при балансе %i', (balance, percent, remaining, reached) => {
    const { book, goal } = fixture();
    const next = save(book, goal);
    // A withdrawal can overdraw an account; the displayed balance must stay real.
    next.transactions.push({ id: id(), kind: 'adjustment', accountId: goal.accountId, amount: balance - 2000000, date, note: '', createdAt: now.toISOString() });
    expect(savingsGoalProgress(next, goal, date)).toMatchObject({ balance, percent, remaining, reached });
  });
  it('не фиксирует достижение навсегда и не включает будущие движения', () => {
    const { book, goal } = fixture();
    let next = save(book, { ...goal, targetAmount: 2000000 });
    expect(savingsGoalProgress(next, next.goals[0], date).reached).toBe(true);
    next = apply(next, { type: 'account.correct', accountId: goal.accountId, balance: 1000000, date, note: '' });
    next.transactions.push({ id: id(), kind: 'adjustment', accountId: goal.accountId, amount: 9000000, date: '2026-11-13', note: '', createdAt: now.toISOString() });
    expect(savingsGoalProgress(next, next.goals[0], date)).toMatchObject({ balance: 1000000, reached: false, percent: 50 });
    expect(next.goals[0].archived).toBe(false);
  });
  it('считает календарные месяцы включительно и округляет ориентир вверх до тенге', () => {
    const { book, goal } = fixture();
    const progress = (dueDate: string, at = date) => savingsGoalProgress(book, { ...goal, dueDate }, at);
    expect(progress('').monthly).toBeNull();
    expect(progress('2026-11-12')).toMatchObject({ monthly: 8000000, overdue: false });
    expect(progress('2026-11-30').monthly).toBe(8000000);
    expect(progress('2027-01-01').monthly).toBe(2666700);
    expect(progress('2027-02-28', '2026-12-31').monthly).toBe(2666700);
    expect(progress('2026-11-11')).toMatchObject({ monthly: null, overdue: true });
    expect(savingsGoalProgress(book, { ...goal, targetAmount: 1000000, dueDate: '2026-11-01' }, date)).toMatchObject({ monthly: null, reached: true, overdue: false });
  });
});
