# Лига лидеров: Telegram-бот и админка игры

Next.js/Vercel приложение для финансовой деловой игры. В отличие от оригинала с 7 Telegram-ботами, здесь используется один бот: капитан выбирает свою команду, а сервер дальше маршрутизирует сценарий по команде и цвету ветки.

## Что уже есть

- Один Telegram webhook: `/api/telegram/webhook`.
- 7 команд: `team-1` ... `team-7`.
- Команды 1-4: красная ветка `Якорь`.
- Команды 5-7: синяя ветка `Шахта / Вышка / Птица`.
- 4 общих этапа: Q1, Q2, Q3, конец Q3.
- Выбор решения, отдельная кнопка `Подтвердить`, затем загрузка Excel.
- В синей Q2 три последовательных вопроса: найм, PR, аванс бонуса.
- Админка: старт игры, переход дальше, повторная отправка, принудительное решение, сброс.
- Supabase Postgres + Supabase Storage для файлов.

## Локальный старт

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Открой `http://localhost:3000`.

## Supabase

1. Открой проект Supabase.
2. Перейди в SQL Editor.
3. Выполни `supabase/schema.sql`.
4. В Storage должен появиться private bucket `team-files`.

Если хочешь, чтобы Codex сам применил SQL, нужен Postgres connection string `DIRECT_URL` или `DATABASE_URL`, а не Supabase API secret key.

## Env

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

SUPABASE_URL=https://rnmkcwwdenreezpxfgfn.supabase.co
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=team-files

ADMIN_DASHBOARD_TOKEN=
NEXT_PUBLIC_APP_NAME=Лига лидеров
```

`SUPABASE_SECRET_KEY` - новый серверный ключ Supabase `sb_secret_...`.

`SUPABASE_SERVICE_ROLE_KEY` - старый legacy `service_role`, если в проекте нет нового key format.

`ADMIN_DASHBOARD_TOKEN` защищает админку ссылкой:

```text
https://your-vercel-domain.vercel.app/?token=YOUR_ADMIN_DASHBOARD_TOKEN
```

## Telegram webhook

После деплоя на Vercel:

```powershell
npm run webhook:set -- -BotToken "123:ABC" -BaseUrl "https://your-vercel-domain.vercel.app" -SecretToken "your-secret"
```

Проверка:

```text
https://your-vercel-domain.vercel.app/api/telegram/webhook
```

## Сценарий

Подробный разбор оригинального бота и XMind лежит в `docs/original-bot-analysis.md`.

## Основные файлы

- `src/lib/scenario.ts` - сценарный движок.
- `src/lib/game-data.ts` - Supabase store и игровые действия.
- `src/lib/game-bot.ts` - Telegram flow.
- `src/components/admin-dashboard.tsx` - админка.
- `src/app/api/admin/action/route.ts` - команды организатора.
- `src/app/api/dashboard/route.ts` - snapshot админки.
- `supabase/schema.sql` - схема БД.
