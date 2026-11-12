export class RequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function safeError(error: unknown): string {
  if (error instanceof Error && error.name === 'ZodError') return 'Проверьте поля, даты и суммы';
  // Transport errors may include a Telegram URL with the bot token. Neither
  // transport details nor SDK/database objects belong in a user-facing message.
  if (error instanceof Error && error.name === 'Error' && !/Missing server|Origin|JSON|token|database|JWT|https?:|fetch|network|Telegram API/i.test(error.message)) return error.message;
  return 'Не удалось выполнить запрос. Попробуйте ещё раз.';
}
