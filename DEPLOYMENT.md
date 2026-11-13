# Развёртывание Tiyn

## Production

- Приложение: https://tiyn-six.vercel.app
- Telegram: https://t.me/tiyn_pro_bot?startapp
- Исходники: https://github.com/dauletakberdiyev/tiyn_pro
- Проект Vercel: https://vercel.com/daulet12/tiyn
- Ветка production: `main`.
- Node.js: `24.x`; зависимости зафиксированы в `package-lock.json`.
- Supabase: `gjyxkfmvvnwdrydlexti`, регион PostgreSQL и функций приложения — `ap-southeast-2`.

## Публикация frontend из GitHub

Рабочий процесс: коммит → push в `main` → Vercel запускает проверки и сборку → успешная сборка публикуется на прежнем основном адресе. ZIP и папку `dist/` загружать не нужно.

Параметры в `vercel.json`:

- Framework: Vite.
- Install command: `npm ci`.
- Build command: `npm run check && npm run build`.
- Output directory: `dist`.
- Root directory: корень репозитория.

Существующий проект Vercel `tiyn` подключён к `dauletakberdiyev/tiyn_pro`. Production публикуется из `main`; настроены Node.js 24, Vite, `npm ci`, проверки и сборка `dist`. Основной домен остаётся `tiyn-six.vercel.app`.

В окружении **Production** Vercel должны быть три публичные переменные из локального `.env.local`:

| Переменная | Назначение |
| --- | --- |
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Публичный клиентский ключ Supabase |
| `VITE_TELEGRAM_BOT_USERNAME` | `tiyn_pro_bot` |

Эти переменные включаются в клиентскую сборку. Серверные токены туда добавлять нельзя. При изменении переменных требуется новая сборка.

Preview без переменных Supabase работает в демонстрационном режиме. Production-вход через Telegram использует основной домен, разрешённый серверным CORS; случайные preview-домены в список доступа не добавляются.

Перед отправкой изменений:

```sh
nvm use
npm ci
npm run check
npm run build
git add <изменённые-файлы>
git commit -m "Описание изменения"
git push origin main
```

Статус публикации виден во вкладке Deployments проекта Vercel. При ошибке тестов или сборки нужно исправить её и отправить следующий коммит.

## Backend Supabase

Git-интеграция Vercel публикует только frontend. Она не запускает SQL-миграции, не сбрасывает базу и не публикует Edge Functions. Обновления backend выполняются отдельно; серверные секреты хранятся в Supabase.

Текущие миграции:

- `20261112132555_finance` — таблицы, RLS, атомарное сохранение и защита от повторов.
- `20261112133215_reminders` — планировщик уведомлений.
- `20261112151133_prepare_finance_request` — объединённая серверная подготовка запросов, доступная только `service_role`.

Функции: `telegram-login`, `finance-api`, `telegram-bot`, `reminders`. `getUser()` проверяет пользователя; загрузка существующего бюджета делает два внутренних обращения к Auth/Data API, сохранение без конфликта — три. Контроль revision и requestId сохраняется в атомарном commit.

Frontend и webhook бота закреплены за Сиднеем. Webhook: `https://gjyxkfmvvnwdrydlexti.supabase.co/functions/v1/telegram-bot?forceFunctionRegion=ap-southeast-2`. CORS разрешает основной домен и локальный dev-origin; preflight кэшируется на 600 секунд. Финансовые ответы используют `Cache-Control: no-store`.

Подробности локальной настройки backend описаны в [README.md](README.md).

### Выпуск целей накоплений

Коллекция `goals` добавляется в JSON бюджета с сохранением `schemaVersion: 1`. Старые облачные и локальные данные без этого поля читаются как `goals: []`; SQL-миграция и массовая перезапись бюджетов не нужны.

Перед публикацией frontend обновите **все четыре** Edge Functions (`telegram-login`, `finance-api`, `telegram-bot`, `reminders`) из одной версии исходников. В каждой развёрнутой функции находится собственная копия общей доменной модели. Особенно важно обновить обоих писателей — API и бота — до создания первых целей: старый валидатор отбросит поле `goals` при следующем сохранении бюджета.

После появления целей не откатывайте функции на версию без их поддержки. Для отключения интерфейса можно откатить frontend, сохранив совместимый backend. На локальном устройстве закройте старые вкладки перед использованием обновлённой версии: старые вкладки сохраняют полный бюджет в localStorage.

После выпуска проверьте создание цели, исключение счёта из суммы на день, пополнение переводом, запись процентов через бота и повторное открытие приложения. Цели должны сохраниться вместе с обновлённым остатком.

## Секреты и локальные файлы

- `.env.local` — локальная публичная конфигурация frontend.
- `supabase/functions/.env.local` — токен бота, webhook secret и Cron secret.
- `.local/`, `.vercel/`, `.openai/` — локальные артефакты и настройки, не входящие в Git.
- `node_modules/` и `dist/` не входят в Git: Vercel устанавливает зависимости и собирает приложение сам.

В репозитории хранятся только шаблоны `.env.example`. Пользовательские финансовые данные находятся в Supabase и в Git не экспортируются.
