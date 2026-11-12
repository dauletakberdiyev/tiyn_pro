interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void; expand(): void;
  setHeaderColor(color: string): void; setBackgroundColor(color: string): void;
  onEvent(name: string, callback: () => void): void; offEvent(name: string, callback: () => void): void;
  requestWriteAccess?: (callback: (allowed: boolean) => void) => void;
  BackButton: { show(): void; hide(): void; onClick(callback: () => void): void; offClick(callback: () => void): void };
  HapticFeedback?: { impactOccurred(style: 'light'): void; notificationOccurred(style: 'success' | 'error'): void };
}
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }
export const telegram = () => {
  const app = window.Telegram?.WebApp;
  return app?.initData ? app : undefined;
};
export function initializeTelegram() {
  const app = telegram(); if (!app?.initData) return () => {};
  const update = () => {
    const insets = app.contentSafeAreaInset;
    document.documentElement.style.setProperty('--tg-top', `${insets?.top ?? 0}px`);
    document.documentElement.style.setProperty('--tg-bottom', `${insets?.bottom ?? 0}px`);
  };
  app.ready(); app.expand(); update(); app.onEvent('contentSafeAreaChanged', update);
  return () => app.offEvent('contentSafeAreaChanged', update);
}
