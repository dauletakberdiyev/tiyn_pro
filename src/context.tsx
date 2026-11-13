import { createContext, useContext } from 'react';
import type { Book, Command, Occurrence, Transaction } from '../supabase/functions/_shared/domain.ts';
export type Page = 'home' | 'operations' | 'budget' | 'analytics';
export interface Filters { from: string; to: string; kind: string; categoryId: string; accountId: string; search: string }
export interface Modal {
  type: 'transaction' | 'accounts' | 'account' | 'correct' | 'settings' | 'budget' | 'category' | 'categories' | 'schedule' | 'complete' | 'debts' | 'debt' | 'repay' | 'allowance' | 'onboard' | 'reset' | 'demoReset' | 'bot' | 'export' | 'goals' | 'goal';
  id?: string;
  draft?: Omit<Transaction, 'createdAt'>;
  occurrence?: Occurrence;
  returnToGoal?: { id?: string };
}
interface Context {
  book: Book; busy: boolean; date: string; page: Page; month: string; setMonth: (month: string) => void;
  filters: Filters; setFilters: (filters: Partial<Filters>) => void;
  open: (modal: Modal) => void; close: () => void; navigate: (page: Page) => void;
  run: (command: Command, message?: string) => Promise<void>;
  perform: (command: Command, message?: string) => void;
  notify: (message: string) => void;
  removeTransaction: (transaction: Transaction) => Promise<void>;
  resetDemo: () => Promise<void>;
}
export const AppContext = createContext<Context | null>(null);
export function useApp() { const ctx = useContext(AppContext); if (!ctx) throw new Error('Отсутствует контекст приложения'); return ctx; }
