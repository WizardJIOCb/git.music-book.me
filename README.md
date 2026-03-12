# gpt.music-book.me

Минимальный MVP для проверки отдельного GPT-сайта на домене `gpt.music-book.me`.

## Что внутри

- статический фронтенд с чат-интерфейсом
- backend на чистом Node.js без внешних зависимостей
- вызов OpenAI Responses API с серверным `OPENAI_API_KEY`
- поддержка внешнего relay через `OPENAI_BASE_URL`
- готовый Cloudflare Worker relay в `relay/`

## Локальный запуск

1. Скопировать `.env.example` в `.env`
2. Задать `OPENAI_API_KEY`
3. Запустить:

```powershell
node server.js
```

Сайт откроется на `http://localhost:3000`.

Импорт заказов из Tilda:

```powershell
npm run import:tilda-orders
```

## Переменные окружения

- `OPENAI_API_KEY` - ключ OpenAI
- `OPENAI_MODEL` - модель, по умолчанию `gpt-4.1-mini`
- `OPENAI_BASE_URL` - базовый URL upstream API, по умолчанию `https://api.openai.com/v1`
- `OPENAI_PROJECT` - опциональный OpenAI project id
- `TILDA_WEBHOOK_SECRET` - секрет для входящих webhook-запросов из Tilda CRM/форм
- `SYSTEM_PROMPT` - системная инструкция для ассистента
- `SITE_URL` и `SITE_NAME` - служебные значения для домена

## Relay режим

Если сервер `gpt.music-book.me` находится в неподдерживаемом OpenAI регионе, можно оставить сайт на текущем сервере, а OpenAI-запросы отправлять через внешний relay.

Пример для `.env`:

```env
OPENAI_BASE_URL=https://your-relay.example.workers.dev/v1
```

## Cloudflare Worker relay

В папке `relay/` лежит простой worker, который проксирует запросы на OpenAI Responses API.

Типовой запуск:

```bash
cd relay
wrangler secret put OPENAI_API_KEY
wrangler deploy
```

После деплоя нужно прописать URL worker в `OPENAI_BASE_URL` основного сайта.

## Deploy на сервере

На сервере проект живёт в `/var/www/gpt.music-book.me` и обновляется через git.

Быстрый деплой:

```bash
cd /var/www/gpt.music-book.me
bash deploy.sh
```

Что делает `deploy.sh`:

- подтягивает изменения из `origin/main`
- проверяет синтаксис `server.js`, `lib/orders.js`, `scripts/import-tilda-orders.js` и `public/app.js`
- перезапускает `pm2`-процесс `gpt-music-book`

### Деплой с локального Windows-компьютера

Можно деплоить одной командой из корня проекта:

```powershell
.\deploy-prod.ps1
```

Скрипт:

- делает `git push origin main`
- подключается по SSH к `root@82.146.42.213`
- запускает на сервере `bash deploy.sh`

Полезные варианты:

```powershell
.\deploy-prod.ps1 -SkipPush
.\deploy-prod.ps1 -Branch main
```

## Заказы из Tilda

Интеграция заказов использует единое локальное хранилище `data/orders/*.json`.
В него пишут и CSV-импорт, и webhook `POST /api/tilda/webhook`.

Что поддерживается:

- импорт CSV-выгрузки Tilda через `scripts/import-tilda-orders.js`
- приём новых и обновлённых заказов через webhook
- поиск заказа в чате по телефону, трек-номеру или по полным ФИО вместе с адресом
- безопасный ответ ассистента: при слабом совпадении он просит уточнить данные

### Разовый импорт CSV

По умолчанию импортируется файл:

```text
orders/leads-95f85ca9e657c61cf1133d7f7d4409f3e366b2ba9f88e7217215736531139774.csv
```

Запуск:

```powershell
npm run import:tilda-orders
```

Можно указать другой файл:

```powershell
node scripts/import-tilda-orders.js .\orders\my-export.csv
```

После импорта заказы появятся в `data/orders`. Эта папка не коммитится в git.

### Подключение webhook

1. Задай на сервере `TILDA_WEBHOOK_SECRET` в `.env`.
2. В Tilda укажи webhook URL:

```text
https://gpt.music-book.me/api/tilda/webhook?secret=YOUR_SECRET
```

3. Настрой отправку заказов или CRM lead updates на этот URL.

Webhook пишет в тот же формат `data/orders/*.json`, поэтому типовой сценарий такой:

1. Один раз импортировать старые заказы из CSV.
2. Затем поддерживать актуальность новыми webhook-событиями.

Какие поля сохраняются:

- `id`, `createdAt`, `updatedAt`
- `customerName`, `firstName`, `lastName`
- `phone`, `phoneNormalized`, `email`
- `address`, `city`, `postalCode`, `country`
- `trackNumber`
- `orderStatus`, `deliveryStatus`, `paymentStatus`
- `paymentMethod`
- `deliveryMethod`, `deliveryMethodName`, `deliveryPrice`, `deliveryDate`
- `totalPrice`, `currency`
- `items`, `itemsSummary`
- `flags`, `notes`, `raw`
