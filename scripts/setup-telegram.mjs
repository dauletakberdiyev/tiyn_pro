// Loads secrets only from the explicitly selected local env file; never logs them.
const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'MINI_APP_URL', 'PROJECT_URL'];
for (const key of required) if (!process.env[key]) throw new Error(`Укажите ${key} в supabase/functions/.env.local`);
const miniApp = new URL(process.env.MINI_APP_URL);
const project = new URL(process.env.PROJECT_URL);
const webhook = new URL('/functions/v1/telegram-bot', project);
webhook.searchParams.set('forceFunctionRegion', 'ap-southeast-2');
if (miniApp.protocol !== 'https:' || project.protocol !== 'https:') throw new Error('Для Telegram нужны HTTPS-адреса');
if (!/^[A-Za-z0-9_-]{1,256}$/.test(process.env.TELEGRAM_WEBHOOK_SECRET)) throw new Error('Webhook secret должен содержать только A-Z, a-z, 0-9, _ и -');
if (!process.argv.includes('--apply')) {
  console.log(`Будут настроены webhook ${webhook.href}, меню Mini App и команды на русском.`);
  console.log('Проверка завершена. Для применения: npm run setup:telegram -- --apply');
  process.exit(0);
}
async function call(method, data) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram отклонил ${method}: код ${result.error_code}`);
  console.log(`${method}: готово`);
}
await call('setWebhook', { url: webhook.href, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Мой бюджет', web_app: { url: miniApp.href } } });
await call('setMyCommands', { language_code: 'ru', commands: [{ command: 'start', description: 'Открыть личный бюджет' }, { command: 'help', description: 'Как записывать расходы и доходы' }] });
console.log('Бот настроен. В BotFather включите Main Mini App с тем же HTTPS-адресом.');
