-- Таблица заявок в YDB (Serverless).
-- Поля соответствуют структуре заявки в админке (index.html).
CREATE TABLE leads (
    id             Utf8,               -- uuid
    client         Utf8,               -- имя клиента
    phone          Utf8,
    destination    Utf8,               -- направление (Мальдивы, Маврикий, ...)
    departure_city Utf8,               -- город вылета
    depart_date    Date,               -- дата вылета
    nights         Utf8,               -- "7 ночей"
    budget         Uint64,             -- бюджет, руб.
    grp            Utf8,               -- состав (пара, семья, ...); group — зарезервированное слово
    villa          Utf8,               -- тип виллы
    meal           Utf8,               -- питание
    reef           Bool,               -- домашний риф
    notes          Utf8,               -- комментарий клиента
    status         Utf8,               -- new | progress | confirmed | closed
    created_at     Timestamp,
    PRIMARY KEY (id)
);

-- Подписки на push-уведомления (Web Push).
-- Одна строка = одно устройство/браузер, где Мария разрешила уведомления.
-- endpoint — уникальный URL подписки, он же первичный ключ.
CREATE TABLE push_subs (
    endpoint   Utf8,
    p256dh     Utf8,               -- публичный ключ шифрования подписки
    auth       Utf8,               -- секрет аутентификации подписки
    created_at Timestamp,
    PRIMARY KEY (endpoint)
);
