import { emptyBook, id, monthOf, today, addDays, monthlyDate, type Book, type Transaction } from '../supabase/functions/_shared/domain.ts';

export function demoBook(): Book {
  const book = emptyBook('Мой бюджет');
  const date = today(); const month = monthOf(date); const day = Number(date.slice(-2));
  const main = id(), cash = id(), savings = id();
  book.onboarded = true;
  book.accounts = [
    { id: main, name: 'Kaspi Gold', opening: 12680000, included: true, archived: false, color: '#d89b89' },
    { id: cash, name: 'Наличные', opening: 2850000, included: true, archived: false, color: '#c9c19b' },
    { id: savings, name: 'Накопления', opening: 35000000, included: false, archived: false, color: '#a3bca0' },
  ];
  book.goals = [{ id: id(), name: 'Финансовая подушка', targetAmount: 100000000, accountId: savings, dueDate: addDays(date, 180), archived: false }];
  const category = (name: string) => book.categories.find(c => c.name === name)!.id;
  const tx = (kind: Transaction['kind'], amount: number, name: string, date: string, note: string, accountId = main) => {
    book.transactions.push({ id: id(), kind, amount: amount * 100, categoryId: category(name), accountId, date, note, createdAt: `${date}T08:00:00.000Z` });
  };
  tx('income', 650000, 'Зарплата', `${month}-01`, 'Основная работа');
  tx('expense', 180000, 'Жильё и счета', `${month}-01`, 'Аренда квартиры');
  const templates = [
    ['Кафе и рестораны', 2100, 'Кофе с собой'], ['Продукты', 14850, 'Magnum'],
    ['Транспорт', 2400, 'Такси домой'], ['Кафе и рестораны', 6800, 'Обед с друзьями'],
    ['Продукты', 8200, 'Продукты на неделю'], ['Покупки', 24500, 'Новая рубашка'],
    ['Транспорт', 1850, 'Такси в офис'], ['Связь и подписки', 4990, 'Мобильная связь'],
  ] as const;
  for (let n = 0; n < Math.min(day, 24); n++) {
    const [name, amount, note] = templates[n % templates.length];
    tx('expense', amount, name, `${month}-${String(n + 1).padStart(2, '0')}`, note);
  }
  if (day > 2) tx('expense', 3800, 'Кафе и рестораны', date, 'Завтрак в кофейне');
  if (day > 1) tx('expense', 12650, 'Продукты', addDays(date, -1), 'Покупки домой');
  book.settings = { ...book.settings, defaultAccountId: main, reserve: 5000000, horizon: 'income' };
  book.budgets = [{ month, amount: 42000000, limits: [
    { categoryId: category('Продукты'), amount: 11000000 }, { categoryId: category('Кафе и рестораны'), amount: 4500000 },
    { categoryId: category('Транспорт'), amount: 3500000 }, { categoryId: category('Покупки'), amount: 5000000 },
  ] }];
  const upcomingDay = Math.min(day + 4, Number(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()));
  book.schedules = [
    { id: id(), name: 'Интернет дома', kind: 'expense', amount: 790000, accountId: main, categoryId: category('Связь и подписки'), dueDate: monthlyDate(month, Math.min(day + 2, 28)), repeat: 'monthly', dayOfMonth: Math.min(day + 2, 28), completed: [], archived: false },
    { id: id(), name: 'Подработка', kind: 'income', amount: 12000000, accountId: main, categoryId: category('Подработка'), dueDate: monthlyDate(month, upcomingDay), repeat: 'monthly', dayOfMonth: upcomingDay, completed: [], archived: false },
  ];
  book.debts = [{ id: id(), name: 'Алексей', direction: 'owed', opening: 2000000, dueDate: addDays(date, 7), note: 'За билеты', archived: false }];
  return book;
}
