import { describe, expect, it } from 'vitest';
import { allowance, applyCommand, emptyBook, id, today, type Book, type Schedule, type Transaction } from '../supabase/functions/_shared/domain.ts';

const now = new Date('2026-11-13T07:00:00Z');
const date = '2026-11-13';
const money = (tenge: number) => Math.round(tenge * 100);
const calculate = (book: Book, at = date) => allowance(book, at);
function fixture(opening = 200655) {
  const book = applyCommand(emptyBook(), { type: 'onboard', name: 'Мой бюджет', accountName: 'Kaspi', opening: money(opening) }, now);
  book.settings.horizon = 'income';
  book.schedules.push({ id: id(), name: 'Зарплата', kind: 'income', amount: money(500000), accountId: book.accounts[0].id, categoryId: book.categories.find(c => c.type === 'income')!.id, dueDate: '2026-12-02', repeat: 'monthly', dayOfMonth: 2, completed: [], archived: false });
  return book;
}
function transaction(book: Book, kind: Transaction['kind'], tenge: number, extra: Partial<Transaction> = {}) {
  return applyCommand(book, { type: 'transaction.save', transaction: {
    id: id(), kind, amount: money(tenge), accountId: book.accounts[0].id,
    categoryId: book.categories.find(c => c.type === (kind === 'income' ? 'income' : 'expense'))!.id,
    date, note: '', ...extra,
  } }, now);
}
function bill(book: Book, extra: Partial<Schedule> = {}): Schedule {
  const schedule: Schedule = { id: id(), name: 'Аренда', kind: 'expense', amount: money(60000), accountId: book.accounts[0].id, categoryId: book.categories[0].id, dueDate: '2026-11-20', repeat: 'once', dayOfMonth: 20, completed: [], archived: false, ...extra };
  book.schedules.push(schedule);
  return schedule;
}
function complete(book: Book, schedule: Schedule, amount = schedule.amount, transactionId?: string) {
  return applyCommand(book, { type: 'schedule.complete', scheduleId: schedule.id, dueDate: schedule.dueDate, date, amount, transactionId }, now);
}

describe('Today’s remaining allowance', () => {
  it('charges purchases in full while preserving the daily plan', () => {
    const book = fixture();
    expect(calculate(book)).toMatchObject({ days: 19, dailyPlan: money(10560), remainingToday: money(10560) });
    const spent = transaction(book, 'expense', 1500);
    expect(calculate(spent)).toMatchObject({ dailyPlan: money(10560), todayExpenses: money(1500), todaySpent: money(1500), remainingToday: money(9060), overspentToday: 0 });
    // Fractional purchases must be deducted exactly, with rounding only in the plan.
    expect(calculate(transaction(spent, 'expense', 0.15)).remainingToday).toBe(money(9059.85));
  });

  it('reproduces the reported spending without showing another positive allowance', () => {
    const spent = transaction(fixture(), 'expense', 23889);
    expect(calculate(spent)).toMatchObject({ dailyPlan: money(10560), todaySpent: money(23889), remainingToday: 0, overspentToday: money(13329), deficit: 0 });
    expect(calculate(transaction(spent, 'expense', 1500))).toMatchObject({ dailyPlan: money(10560), remainingToday: 0, overspentToday: money(14829) });
  });

  it('restores the full difference after editing, deleting and undoing a purchase', () => {
    const book = transaction(fixture(), 'expense', 5000);
    const original = book.transactions[0];
    const edited = applyCommand(book, { type: 'transaction.save', transaction: { ...original, amount: money(2000) } }, now);
    expect(calculate(edited).remainingToday).toBe(money(8560));
    const deleted = applyCommand(edited, { type: 'transaction.delete', id: original.id }, now);
    expect(calculate(deleted).remainingToday).toBe(money(10560));
    const restored = applyCommand(deleted, { type: 'transaction.restore', transaction: original, completions: [] }, now);
    expect(calculate(restored).remainingToday).toBe(money(5560));
  });

  it('shows refunds separately and restores the full refund amount', () => {
    const book = transaction(transaction(fixture(), 'expense', 5000), 'refund', 1000);
    expect(calculate(book)).toMatchObject({ dailyPlan: money(10560), todayExpenses: money(5000), todayRefunds: money(1000), todaySpent: money(4000), remainingToday: money(6560) });
  });

  it('caps large refunds at the actual free money and handles a negative reconstructed pool', () => {
    const book = transaction(fixture(0), 'refund', 1000);
    expect(calculate(book)).toMatchObject({ dailyPlan: 0, remainingToday: money(1000), deficit: 0 });
    book.settings.reserve = money(500);
    expect(calculate(book)).toMatchObject({ dailyPlan: 0, remainingToday: money(500) });
    book.settings.reserve = money(1500);
    expect(calculate(book)).toMatchObject({ dailyPlan: 0, remainingToday: 0, deficit: money(500) });
  });

  it('excludes paid reserved bills and retains their links after archiving', () => {
    const book = fixture(260655); const s = bill(book);
    const initial = calculate(book);
    const paid = complete(book, s);
    expect(calculate(paid)).toMatchObject({ dailyPlan: initial.dailyPlan, remainingToday: initial.remainingToday, todayExpenses: 0, todayBills: money(60000), reserved: 0 });
    const archived = applyCommand(paid, { type: 'schedule.save', schedule: { ...paid.schedules.find(schedule => schedule.id === s.id)!, archived: true } }, now);
    expect(calculate(archived)).toMatchObject({ remainingToday: initial.remainingToday, todayExpenses: 0, todayBills: money(60000) });
  });

  it.each([58100, 61900])('replans a bill variance when the actual payment is %i tenge', actual => {
    const book = fixture(260655); const s = bill(book);
    const result = calculate(complete(book, s, money(actual)));
    expect(result).toMatchObject({ todayExpenses: 0, todayBills: money(actual), dailyPlan: money(actual === 58100 ? 10660 : 10460) });
    expect(result.remainingToday).toBe(result.dailyPlan);
  });

  it('treats an early payment outside the horizon as a change in the free pool', () => {
    const book = fixture(260655); const s = bill(book, { dueDate: '2026-12-10' });
    expect(calculate(book).reserved).toBe(0);
    const paid = calculate(complete(book, s));
    expect(paid).toMatchObject({ dailyPlan: money(10560), remainingToday: money(10560), todayExpenses: 0, todayBills: money(60000) });
  });

  it('links a manual payment and restores its reservation on deletion and undo', () => {
    const book = fixture(260655); const s = bill(book);
    const manual = transaction(book, 'expense', 60000);
    expect(calculate(manual).overspentToday).toBe(money(49440));
    const paid = complete(manual, s, s.amount, manual.transactions[0].id);
    expect(calculate(paid)).toMatchObject({ remainingToday: money(10560), todayExpenses: 0, todayBills: money(60000) });
    const deleted = applyCommand(paid, { type: 'transaction.delete', id: manual.transactions[0].id }, now);
    expect(calculate(deleted)).toMatchObject({ remainingToday: money(10560), reserved: money(60000), todayBills: 0 });
    const restored = applyCommand(deleted, { type: 'transaction.restore', transaction: paid.transactions[0], completions: [{ scheduleId: s.id, date: s.dueDate }] }, now);
    expect(calculate(restored)).toEqual(calculate(paid));
  });

  it('uses the payment’s actual account rather than the schedule account for today’s totals', () => {
    const book = fixture(260655);
    const savings = { ...book.accounts[0], id: id(), name: 'Накопления', included: false, opening: money(100000) };
    book.accounts.push(savings);
    const s = bill(book);
    const manual = transaction(book, 'expense', 60000, { accountId: savings.id });
    const linked = calculate(complete(manual, s, s.amount, manual.transactions[0].id));
    expect(linked).toMatchObject({ todayExpenses: 0, todayBills: 0, remainingToday: money(13718) });
    const other = fixture();
    other.accounts.push(savings);
    const excludedBill = bill(other, { accountId: savings.id });
    const includedPayment = transaction(other, 'expense', 60000);
    expect(calculate(complete(includedPayment, excludedBill, excludedBill.amount, includedPayment.transactions[0].id))).toMatchObject({ todayExpenses: 0, todayBills: money(60000), remainingToday: money(7402) });
  });

  it('ignores transfers between included accounts and expenses on excluded accounts', () => {
    const book = fixture();
    const other = { ...book.accounts[0], id: id(), name: 'Наличные', opening: 0 };
    const savings = { ...other, id: id(), name: 'Накопления', opening: money(50000), included: false };
    book.accounts.push(other, savings);
    const moved = transaction(book, 'transfer', 10000, { categoryId: undefined, toAccountId: other.id });
    expect(calculate(moved)).toEqual(calculate(book));
    expect(calculate(transaction(moved, 'expense', 1000, { accountId: savings.id }))).toEqual(calculate(moved));
    const saved = calculate(transaction(moved, 'transfer', 19000, { categoryId: undefined, toAccountId: savings.id }));
    expect(saved).toMatchObject({ todayExpenses: 0, dailyPlan: money(9560), remainingToday: money(9560) });
  });

  it('replans actual income and changed reserves while preserving recorded spending', () => {
    const spent = transaction(fixture(), 'expense', 5000);
    const paid = transaction(spent, 'income', 19000);
    expect(calculate(paid)).toMatchObject({ dailyPlan: money(11560), todaySpent: money(5000), remainingToday: money(6560) });
    const reserved = applyCommand(paid, { type: 'settings.update', settings: { reserve: money(19000) } }, now);
    expect(calculate(reserved)).toMatchObject({ dailyPlan: money(10560), remainingToday: money(5560) });
  });

  it('keeps an unreserved debt repayment separate from ordinary spending', () => {
    const book = fixture(); const debtId = id();
    const debt = applyCommand(book, { type: 'debt.save', debt: { id: debtId, name: 'Долг', direction: 'owe', opening: money(50000), dueDate: '', note: '', archived: false }, moveMoney: false, date }, now);
    const paid = applyCommand(debt, { type: 'debt.repay', debtId, accountId: book.accounts[0].id, amount: money(19000), date }, now);
    expect(calculate(paid)).toMatchObject({ dailyPlan: money(9560), todayExpenses: 0, remainingToday: money(9560) });
  });

  it('keeps period deficits separate from daily overspending', () => {
    const book = fixture(); book.settings.reserve = money(210000);
    expect(calculate(book)).toMatchObject({ remainingToday: 0, dailyPlan: 0, overspentToday: 0, deficit: money(9345) });
    expect(calculate(transaction(book, 'expense', 1000))).toMatchObject({ remainingToday: 0, overspentToday: money(1000), deficit: money(10345) });
  });

  it('redistributes remaining money on the next local day, using financial transaction dates', () => {
    const spent = transaction(fixture(), 'expense', 23889);
    const before = today('Asia/Almaty', new Date('2026-11-13T18:59:59Z'));
    const after = today('Asia/Almaty', new Date('2026-11-13T19:00:00Z'));
    expect(calculate(spent, before).overspentToday).toBe(money(13329));
    expect(calculate(spent, after)).toMatchObject({ days: 18, todaySpent: 0, dailyPlan: money(9820), remainingToday: money(9820), overspentToday: 0 });
    const backdated = transaction(fixture(), 'expense', 19000, { date: '2026-11-12' });
    expect(calculate(backdated)).toMatchObject({ todaySpent: 0, dailyPlan: money(9560), remainingToday: money(9560) });
  });

  it('handles the last day and the no-income fallback without subtracting spending twice', () => {
    const book = fixture(1000); book.schedules = [];
    const spent = applyCommand(book, { type: 'transaction.save', transaction: { id: id(), kind: 'expense', accountId: book.accounts[0].id, categoryId: book.categories[0].id, amount: money(400), date: '2026-11-30', note: '' } }, new Date('2026-11-30T07:00:00Z'));
    expect(calculate(spent, '2026-11-30')).toMatchObject({ days: 1, horizon: '2026-11-30', dailyPlan: money(1000), remainingToday: money(600) });
  });
});
