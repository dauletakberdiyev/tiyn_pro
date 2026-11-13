import { createElement, type ComponentType, type ContextType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppContext } from '../src/context';
import { HomePage } from '../src/pages';
import { AllowanceForm } from '../src/forms';
import { applyCommand, emptyBook, formatMoney, id, type Book } from '../supabase/functions/_shared/domain.ts';

function fixture() {
  const now = new Date('2026-11-13T07:00:00Z');
  let book = applyCommand(emptyBook(), { type: 'onboard', name: 'Мой бюджет', accountName: 'Kaspi', opening: 20065500 }, now);
  book.settings.horizon = 'income';
  book.schedules.push({ id: id(), name: 'Зарплата', kind: 'income', amount: 50000000, accountId: book.accounts[0].id, categoryId: book.categories.find(c => c.type === 'income')!.id, dueDate: '2026-12-02', repeat: 'once', dayOfMonth: 2, completed: [], archived: false });
  book = applyCommand(book, { type: 'transaction.save', transaction: { id: id(), kind: 'expense', accountId: book.accounts[0].id, categoryId: book.categories[0].id, amount: 2388900, date: '2026-11-13', note: '' } }, now);
  return book;
}
function render(Component: ComponentType, book: Book) {
  const context: NonNullable<ContextType<typeof AppContext>> = {
    book, date: '2026-11-13', month: '2026-11', page: 'home', busy: false,
    filters: { from: '2026-11-01', to: '2026-11-13', kind: 'all', categoryId: '', accountId: '', search: '' },
    setMonth: vi.fn(), setFilters: vi.fn(), open: vi.fn(), close: vi.fn(), navigate: vi.fn(),
    run: vi.fn(), perform: vi.fn(), notify: vi.fn(), removeTransaction: vi.fn(), resetDemo: vi.fn(),
  };
  return renderToStaticMarkup(createElement(AppContext.Provider, { value: context }, createElement(Component)));
}
function card(book: Book) {
  const html = render(HomePage, book);
  const match = html.match(/<button class="allowance-card[^>]*>[\s\S]*?<\/button>/);
  expect(match).not.toBeNull();
  return match![0];
}

describe('Allowance presentation', () => {
  it('shows zero remaining and daily overspending instead of the period average', () => {
    const html = card(fixture());
    expect(html).toContain('Осталось на сегодня');
    expect(html).toContain(formatMoney(0));
    expect(html).toContain('План на день');
    expect(html).toContain(formatMoney(1056000));
    expect(html).toContain('Потрачено сегодня');
    expect(html).toContain(formatMoney(2388900));
    expect(html).toContain('Превышение за день');
    expect(html).toContain(formatMoney(1332900));
    expect(html).not.toContain(formatMoney(930300));
    expect(html).not.toContain('Дефицит за период');
  });

  it('reports a separate period deficit alongside daily overspending', () => {
    const book = fixture(); book.settings.reserve = 19000000;
    const html = card(book);
    expect(html).toContain('Дефицит за период');
    expect(html).toContain(formatMoney(1323400));
    expect(html).toContain('Превышение за день');
  });

  it('keeps refunds visible and protects every monetary value when amounts are hidden', () => {
    const book = fixture();
    book.transactions.push({ ...book.transactions[0], id: id(), kind: 'refund', amount: 100000 });
    expect(card(book)).toContain('Возвраты сегодня');
    book.settings.hideAmounts = true;
    for (const html of [card(book), render(AllowanceForm, book)]) {
      expect(html).toContain('•••• ₸');
      expect(html).not.toContain(formatMoney(1056000));
      expect(html).not.toContain(formatMoney(2388900));
      expect(html).not.toContain(formatMoney(100000));
    }
  });

  it('explains today’s calculation before the period calculation and exposes bill linking', () => {
    const html = render(AllowanceForm, fixture());
    expect(html.indexOf('Повседневные траты сегодня')).toBeLessThan(html.indexOf('Как получен план на день'));
    expect(html).toContain('Превышение за день:');
    expect(html).toContain('Добавляем сегодняшние траты');
    expect(html).toContain('Открыть платежи');
  });
});
