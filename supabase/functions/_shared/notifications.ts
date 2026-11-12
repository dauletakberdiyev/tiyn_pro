import { addDays, debtBalance, expenseTotal, formatMoney, getBudget, monthOf, occurrences, today, type Book } from './domain.ts';
export interface Notification { key: string; message: string }
export function notifications(book: Book, now = new Date()): Notification[] {
  const date = today(book.settings.timezone, now);
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: book.settings.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  if (localTime < book.settings.reminderTime || !book.onboarded) return [];
  const result: Notification[] = [];
  const money = (amount: number) => formatMoney(amount, book.settings.hideAmounts);
  if (book.settings.reminders) {
    for (const o of occurrences(book, addDays(date, 1))) {
      if (o.schedule.kind === 'income' || o.date < addDays(date, -1)) continue;
      const when = o.date === date ? 'сегодня' : o.date > date ? 'завтра' : 'ожидает оплаты со вчера';
      result.push({ key: `payment:${o.key}:${date}`, message: `Tiyn · ${o.schedule.name}\n${money(o.schedule.amount)} · ${when}\nОткройте приложение, чтобы отметить оплату.` });
    }
    for (const debt of book.debts) {
      if (debt.archived || !debt.dueDate || debt.dueDate < addDays(date, -1) || debt.dueDate > addDays(date, 1)) continue;
      const remaining = debtBalance(book, debt.id); if (!remaining) continue;
      result.push({ key: `debt:${debt.id}:${debt.dueDate}:${date}`, message: `Tiyn · возврат долга\n${debt.direction === 'owe' ? 'Вы должны' : 'Вам должны'}: ${debt.name} · ${money(remaining)}\nДата возврата: ${debt.dueDate}` });
    }
  }
  if (book.settings.limitAlerts) {
    const budget = getBudget(book, monthOf(date));
    for (const limit of budget.limits) {
      const spent = expenseTotal(book, `${monthOf(date)}-01`, date, limit.categoryId);
      for (const threshold of [80, 100]) if (spent * 100 >= limit.amount * threshold) {
        const category = book.categories.find(c => c.id === limit.categoryId);
        result.push({ key: `limit:${monthOf(date)}:${limit.categoryId}:${threshold}`, message: `Tiyn · ${category?.name ?? 'Категория'}\n${threshold === 100 ? 'Лимит достигнут' : 'Использовано 80% лимита'}: ${money(spent)} из ${money(limit.amount)}.` });
      }
    }
  }
  if (book.settings.weeklyReport && new Date(`${date}T12:00Z`).getUTCDay() === 1) {
    const from = addDays(date, -7), to = addDays(date, -1);
    const total = expenseTotal(book, from, to);
    const top = book.categories.filter(c => c.type === 'expense').map(c => ({ name: c.name, amount: expenseTotal(book, from, to, c.id) })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 3);
    const budget = getBudget(book, monthOf(date));
    const used = expenseTotal(book, `${monthOf(date)}-01`, date);
    result.push({ key: `weekly:${date}`, message: `Tiyn · итоги недели ${from} — ${to}\nПотрачено: ${money(total)}\n${top.map(c => `${c.name}: ${money(c.amount)}`).join('\n')}${budget.amount ? `\nБюджет месяца: ${Math.round(used / budget.amount * 100)}% использовано` : ''}` });
  }
  return result;
}
