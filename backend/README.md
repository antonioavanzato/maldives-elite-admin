# Бэкенд Maldives Elite (Yandex Cloud)

Архитектура:

```
Форма /anketa ──POST /submit──▶ API Gateway ──▶ form-intake ──┬─▶ YDB (все данные)
                                                              ├─▶ Telegram-канал (только имя)
                                                              └─▶ Web Push (только имя)

Админка (PWA) ──/login, /leads, /push/subscribe──▶ API Gateway ──▶ admin-api ──▶ YDB
```

Персональные данные (телефон, детали заявки) хранятся только в YDB (дата-центры
Яндекса, РФ — требования 152-ФЗ соблюдены). В Telegram и в push уходит
дублирующее уведомление без персональных данных: «Новая заявка: Имя».

## Состав

| Файл | Назначение |
|---|---|
| `schema.sql` | Таблицы `leads` и `push_subs` в YDB |
| `form-intake/index.js` | Приём формы: валидация → запись в YDB → Telegram + Web Push |
| `admin-api/index.js` | API админки: логин, список, статус, удаление, `/push/subscribe` |
| `api-gateway.yaml` | Спецификация API Gateway (заменить ID перед загрузкой) |
| `build-functions.sh` | Сборка ZIP-архивов функций → `dist/` |

> Полная пошаговая инструкция по развёртыванию — в папке `deploy/` в корне
> репозитория (`НАЧНИ-ОТСЮДА.md` — простая версия, `ИНСТРУКЦИЯ-ДЕПЛОЙ.md` — подробная).

## Переменные окружения функций (задаются в консоли Яндекса, НЕ в коде)

**form-intake:**
- `YDB_ENDPOINT` — например `grpcs://ydb.serverless.yandexcloud.net:2135`
- `YDB_DATABASE` — путь базы, например `/ru-central1/b1g.../etn...`
- `TG_BOT_TOKEN` — токен бота
- `TG_CHAT_ID` — ID закрытого канала
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — для Web Push
  (необязательно; без них push просто не шлётся). Генерация: `npx web-push generate-vapid-keys`

**admin-api:**
- `YDB_ENDPOINT`, `YDB_DATABASE` — те же
- `ADMIN_EMAIL` — почта для входа в админку
- `ADMIN_PASSWORD_HASH` — sha256-хэш пароля: `printf '%s' "пароль" | shasum -a 256 | awk '{print $1}'`
- `SESSION_SECRET` — случайная строка для подписи сессий: `openssl rand -hex 32`

Авторизация в YDB — через сервисный аккаунт функции (роль `ydb.editor`),
ключи в коде не нужны.

## Кратко о развёртывании

1. Сервисный аккаунт с ролями `ydb.editor`, `functions.functionInvoker`.
2. Serverless YDB → выполнить `schema.sql`.
3. `bash build-functions.sh` → задеплоить обе функции (nodejs18+), окружение — выше.
4. В `api-gateway.yaml` подставить ID функций и сервисного аккаунта → создать API Gateway.
5. В `index.html` админки прописать `API_BASE` = URL шлюза; разместить админку на HTTPS.
6. Форму `/anketa` перенаправить на `POST {gateway}/submit` (см. `deploy/ФОРМА-АНКЕТА.md`).

Подробности каждого шага — в `deploy/`.
