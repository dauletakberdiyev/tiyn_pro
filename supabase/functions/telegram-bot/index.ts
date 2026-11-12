import { admin, applyToUser, body, botApi, env, json, loadBook, rateLimit, safeError, stableId } from '../_shared/server.ts';
import { constantTimeEqual } from '../_shared/telegram-auth.ts';
import { parseText } from '../_shared/parser.ts';
import { formatDate, formatMoney, id, today, type Book, type Transaction } from '../_shared/domain.ts';

interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; write_access_allowed?: object; chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean } };
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { chat: { id: number; type: string }; message_id: number } };
}
const appKeyboard = () => ({ inline_keyboard: [[{ text: 'Открыть Tiyn', web_app: { url: env('MINI_APP_URL') } }]] });
async function acknowledge(chatId: number, book: Book, tx: Omit<Transaction, 'createdAt'>) {
  const category = book.categories.find(c => c.id === tx.categoryId)?.name ?? 'Другое';
  const account = book.accounts.find(a => a.id === tx.accountId)?.name ?? '';
  return botApi('sendMessage', { chat_id: chatId,
    text: `${tx.kind === 'income' ? 'Доход' : 'Расход'} ${formatMoney(tx.amount, book.settings.hideAmounts)}\n${category} · ${account} · ${formatDate(tx.date)}\n${tx.note}`,
    reply_markup: { inline_keyboard: [[{ text: 'Изменить', web_app: { url: `${env('MINI_APP_URL')}?edit=${tx.id}` } }, { text: 'Отменить', callback_data: `undo:${tx.id}` }]] },
  });
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!constantTimeEqual(request.headers.get('x-telegram-bot-api-secret-token') ?? '', env('TELEGRAM_WEBHOOK_SECRET'))) return json({ error: 'Unauthorized' }, 401);
  let update: TelegramUpdate | undefined;
  let chatId: number | undefined;
  try {
    update = await body(request) as unknown as TelegramUpdate;
    if (!Number.isSafeInteger(update.update_id)) return json({ error: 'Invalid update' }, 400);
    const db = admin();
    const claimed = await db.rpc('claim_telegram_update', { p_update_id: update.update_id });
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return json({ ok: true });
    const message = update.message; const callback = update.callback_query;
    const chat = message?.chat ?? callback?.message?.chat;
    const telegramId = message?.from?.id ?? callback?.from.id;
    if (!chat || chat.type !== 'private' || !Number.isSafeInteger(telegramId)) {
      await db.from('telegram_updates').update({ status: 'done' }).eq('update_id', update.update_id);
      return json({ ok: true });
    }
    chatId = chat.id;
    await rateLimit(`bot:${telegramId}`, 30, 60);
    const mapping = await db.from('telegram_links').select('user_id').eq('telegram_id', telegramId).maybeSingle();
    if (mapping.error) throw mapping.error;
    if (!mapping.data) {
      await botApi('sendMessage', { chat_id: chatId, text: 'Добро пожаловать в Tiyn. Откройте приложение и добавьте первый счёт — после этого расходы можно записывать прямо здесь.', reply_markup: appKeyboard() });
    } else {
      const userId = mapping.data.user_id;
      const mapped = await db.from('telegram_links').update({ chat_id: chatId, write_access: true }).eq('telegram_id', telegramId);
      if (mapped.error) throw mapped.error;
      const { book } = await loadBook(userId);
      const date = today(book.settings.timezone);
      if (message?.write_access_allowed) {
        // Telegram service event confirms the user allowed private messages.
      } else if (callback?.data?.startsWith('undo:')) {
        const txId = callback.data.slice(5);
        if (!book.transactions.some(t => t.id === txId)) await botApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Запись уже удалена' });
        else {
          await applyToUser(userId, await stableId(`undo:${txId}`), { type: 'transaction.delete', id: txId });
          await botApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Операция удалена' });
          if (callback.message) await botApi('editMessageReplyMarkup', { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
        }
      } else if (callback?.data?.startsWith('cat:')) {
        const [, draftId, indexText] = callback.data.split(':');
        const result = await db.from('bot_drafts').select('*').eq('id', draftId).eq('user_id', userId).maybeSingle();
        if (result.error) throw result.error;
        const draft = result.data;
        if (!draft || draft.expires_at < new Date().toISOString()) await botApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Черновик устарел. Отправьте сообщение ещё раз.' });
        else if (draft.consumed_at) await botApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Эта запись уже сохранена' });
        else {
          const index = Number(indexText); const categoryId = draft.payload.categoryIds[index];
          if (!Number.isInteger(index) || !categoryId) throw new Error('Категория не найдена');
          const tx = { ...draft.payload.transaction, categoryId };
          const next = await applyToUser(userId, await stableId(`draft:${draftId}`), { type: 'transaction.save', transaction: tx });
          const consumed = await db.from('bot_drafts').update({ consumed_at: new Date().toISOString() }).eq('id', draftId).eq('user_id', userId);
          if (consumed.error) throw consumed.error;
          await botApi('answerCallbackQuery', { callback_query_id: callback.id, text: 'Записано' });
          await acknowledge(chatId, next, tx);
          if (callback.message) await botApi('editMessageReplyMarkup', { chat_id: chatId, message_id: callback.message.message_id, reply_markup: { inline_keyboard: [] } });
        }
      } else if (message?.text?.startsWith('/') || !book.onboarded) {
        await botApi('sendMessage', { chat_id: chatId, text: 'Tiyn — ваш личный бюджет.\n\nПримеры:\nкофе 1800\nтакси 2500 вчера\nдоход 350000 зарплата\n\nОсновной счёт подставляется автоматически. Неоднозначную категорию я уточню. В приложении доступны переводы, лимиты, долги и экспорт данных.', reply_markup: appKeyboard() });
      } else if (message?.text) {
        const parsed = parseText(message.text, book, date);
        parsed.draft.id = await stableId(`transaction:${update.update_id}`);
        if (parsed.needsAccount) await botApi('sendMessage', { chat_id: chatId, text: 'Сначала добавьте действующий счёт в приложении.', reply_markup: appKeyboard() });
        else if (parsed.needsCategory) {
          const draftId = await stableId(`draft:${update.update_id}`);
          const categories = book.categories.filter(c => !c.archived && c.type === parsed.draft.kind);
          const saved = await db.from('bot_drafts').upsert({ id: draftId, user_id: userId, payload: { transaction: parsed.draft, categoryIds: categories.map(c => c.id) } }, { onConflict: 'id', ignoreDuplicates: true });
          if (saved.error) throw saved.error;
          const buttons = categories.map((c, index) => ({ text: c.name, callback_data: `cat:${draftId}:${index}` }));
          const rows = Array.from({ length: Math.ceil(buttons.length / 2) }, (_, i) => buttons.slice(i * 2, i * 2 + 2));
          await botApi('sendMessage', { chat_id: chatId, text: `${formatMoney(parsed.draft.amount, book.settings.hideAmounts)} · ${formatDate(parsed.draft.date)}\nВыберите категорию, чтобы записать операцию:`, reply_markup: { inline_keyboard: rows } });
        } else {
          const next = await applyToUser(userId, await stableId(`command:${update.update_id}`), { type: 'transaction.save', transaction: parsed.draft });
          await acknowledge(chatId, next, parsed.draft);
        }
      } else await botApi('sendMessage', { chat_id: chatId, text: 'Пока я принимаю текст. Например: кофе 1800. Голосовой ввод и распознавание чеков появятся позже.' });
    }
    const done = await db.from('telegram_updates').update({ status: 'done' }).eq('update_id', update.update_id);
    if (done.error) throw done.error;
    return json({ ok: true });
  } catch (error) {
    console.error('telegram-bot failed', error instanceof Error ? error.name : 'database');
    if (chatId && error instanceof Error && (error.name === 'ZodError' || (error.name === 'Error' && !/Telegram API|Missing|database|https?:|fetch|network/i.test(error.message)))) {
      try {
        await botApi('sendMessage', { chat_id: chatId, text: safeError(error) });
        if (update) await admin().from('telegram_updates').update({ status: 'done' }).eq('update_id', update.update_id);
        return json({ ok: true });
      } catch { /* Let Telegram retry a transient transport failure. */ }
    }
    return json({ error: 'Temporary failure' }, 503);
  }
});
