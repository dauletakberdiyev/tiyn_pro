import { id, parseMoney, addDays, dateSchema, type Book, type Transaction } from './domain.ts';

const aliases: Record<string, string[]> = {
  'Продукты': ['продукт', 'магазин', 'супермаркет', 'magnum', 'small'],
  'Кафе и рестораны': ['кофе', 'кафе', 'донер', 'обед', 'ужин', 'ресторан', 'пицца', 'доставка еды'],
  'Транспорт': ['такси', 'автобус', 'метро', 'бензин', 'парковка', 'яндекс', 'uber'],
  'Жильё и счета': ['аренда', 'квартира', 'коммунал', 'жильё'],
  'Связь и подписки': ['интернет', 'телефон', 'подписка', 'netflix', 'spotify', 'связь'],
  'Покупки': ['одежда', 'обувь', 'покупки', 'ozon', 'wildberries'],
  'Здоровье': ['аптека', 'врач', 'лекарств', 'анализ', 'стоматолог'],
  'Развлечения': ['кино', 'концерт', 'игра', 'развлеч'],
  'Образование': ['курс', 'книга', 'обучение'],
  'Путешествия': ['билет', 'отель', 'путешеств'],
  'Подарки': ['подарок', 'подарки'],
  'Зарплата': ['зарплата', 'аванс'], 'Подработка': ['подработка', 'фриланс'],
};
export interface ParsedText {
  draft: Omit<Transaction, 'createdAt'>;
  needsCategory: boolean;
  needsAccount: boolean;
}
export function parseText(text: string, book: Book, currentDate: string): ParsedText {
  if (text.length > 500) throw new Error('Сообщение слишком длинное. Напишите, например: кофе 1800');
  let cleaned = text.trim().toLocaleLowerCase('ru');
  let date = currentDate;
  const explicitDate = cleaned.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitDate) { date = dateSchema.parse(explicitDate[1]); cleaned = cleaned.replace(explicitDate[0], ''); }
  else if (cleaned.includes('позавчера')) { date = addDays(date, -2); cleaned = cleaned.replace('позавчера', ''); }
  else if (cleaned.includes('вчера')) { date = addDays(date, -1); cleaned = cleaned.replace('вчера', ''); }
  cleaned = cleaned.replace('сегодня', '');
  if (date > currentDate) throw new Error('Будущую операцию добавьте в запланированные платежи');
  const matches = [...cleaned.matchAll(/\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d{1,2})?/g)];
  if (matches.length !== 1) throw new Error('Укажите одну сумму. Например: такси 2500 вчера');
  const amount = parseMoney(matches[0][0]);
  if (!amount) throw new Error('Сумма должна быть больше нуля');
  cleaned = cleaned.replace(matches[0][0], '').replace(/₸|тенге|kzt/gi, '').trim();
  const kind = /(?:^|\s)(доход|зарплата|аванс|подработка)(?:\s|$)/.test(cleaned) ? 'income' : 'expense';
  const accounts = book.accounts.filter(a => !a.archived && cleaned.includes(a.name.toLocaleLowerCase('ru')));
  if (accounts.length > 1) throw new Error('Укажите один счёт. Переводы удобно добавлять в приложении');
  const account = accounts[0] ?? book.accounts.find(a => a.id === book.settings.defaultAccountId && !a.archived) ?? book.accounts.find(a => !a.archived);
  const categories = book.categories.filter(c => !c.archived && c.type === kind);
  const matching = categories.filter(c => cleaned.includes(c.name.toLocaleLowerCase('ru')) || (aliases[c.name] ?? []).some(alias => cleaned.includes(alias)));
  const category = matching.length === 1 ? matching[0] : undefined;
  return {
    draft: { id: id(), kind, amount, accountId: account?.id ?? '', categoryId: category?.id, date, note: cleaned.replace(/^доход\s*/, '').trim() },
    needsCategory: !category, needsAccount: !account,
  };
}
