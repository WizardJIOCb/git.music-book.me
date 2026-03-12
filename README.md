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

## Переменные окружения

- `OPENAI_API_KEY` - ключ OpenAI
- `OPENAI_MODEL` - модель, по умолчанию `gpt-4.1-mini`
- `OPENAI_BASE_URL` - базовый URL upstream API, по умолчанию `https://api.openai.com/v1`
- `OPENAI_PROJECT` - опциональный OpenAI project id
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
