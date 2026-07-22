/* Yandex Cloud Function: приём заявки с формы сайта.
   POST /submit  { client, phone, destination, departureCity, departDate,
                   nights, budget, group, villa, meal, reef, notes }

   1. Валидирует данные.
   2. Пишет заявку в YDB (все данные остаются в РФ — 152-ФЗ).
   3. Шлёт в закрытый Telegram-канал уведомление БЕЗ персональных данных
      (только имя и факт заявки).

   Окружение: YDB_ENDPOINT, YDB_DATABASE, TG_BOT_TOKEN, TG_CHAT_ID.
   Зависимости: ydb-sdk (package.json рядом). */

const { Driver, getCredentialsFromEnv, TypedValues, TypedData } = require("ydb-sdk");
const { randomUUID } = require("crypto");
const webpush = require("web-push");

// VAPID-ключи задаются в переменных окружения функции (см. инструкцию).
// Если их нет — push просто пропускается, приём заявки не ломается.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@maldives-elite.ru",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

let driver; // переиспользуется между вызовами функции

async function getDriver() {
  if (!driver) {
    driver = new Driver({
      endpoint: process.env.YDB_ENDPOINT,
      database: process.env.YDB_DATABASE,
      authService: getCredentialsFromEnv(),
    });
    if (!(await driver.ready(10000))) throw new Error("YDB driver not ready");
  }
  return driver;
}

const CORS = {
  "Access-Control-Allow-Origin": "https://maldives-elite.ru",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function bad(msg) {
  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: msg }) };
}

async function notifyTelegram(clientName) {
  // Только имя — без телефона и деталей.
  const text = `🌴 Новая заявка: ${clientName}\nПодробности — в панели заявок.`;
  const res = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: process.env.TG_CHAT_ID, text }),
  });
  if (!res.ok) console.error("Telegram notify failed:", await res.text());
}

// Push всем подписанным устройствам админки. Тоже только имя, без перс. данных.
// Просроченные подписки (404/410) удаляются, чтобы таблица не копила мусор.
async function notifyPush(clientName) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;
  const d = await getDriver();

  let subs = [];
  await d.tableClient.withSession(async (session) => {
    const { resultSets } = await session.executeQuery("SELECT endpoint, p256dh, auth FROM push_subs;");
    subs = TypedData.createNativeObjects(resultSets[0]);
  });
  if (!subs.length) return;

  const payload = JSON.stringify({
    title: "Новая заявка 🌴",
    body: clientName,
    url: "./",
  });

  const dead = [];
  await Promise.all(subs.map(async (s) => {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) dead.push(s.endpoint);
      else console.error("push send failed:", err && err.statusCode, err && err.body);
    }
  }));

  // подчистить отвалившиеся подписки
  await Promise.all(dead.map((endpoint) =>
    d.tableClient.withSession((session) =>
      session.executeQuery(
        "DECLARE $e AS Utf8; DELETE FROM push_subs WHERE endpoint = $e;",
        { $e: TypedValues.utf8(endpoint) }
      )
    ).catch((e) => console.error("push sub cleanup failed:", e))
  ));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS };

  let data;
  try {
    data = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
  } catch {
    return bad("invalid json");
  }

  const client = String(data.client || "").trim().slice(0, 200);
  const phone = String(data.phone || "").trim().slice(0, 50);
  if (!client || !phone) return bad("client and phone are required");
  if (data.departDate && isNaN(new Date(data.departDate))) return bad("invalid departDate");

  const id = randomUUID();
  const d = await getDriver();

  await d.tableClient.withSession(async (session) => {
    const query = `
      DECLARE $id AS Utf8; DECLARE $client AS Utf8; DECLARE $phone AS Utf8;
      DECLARE $destination AS Utf8; DECLARE $departure_city AS Utf8;
      DECLARE $depart_date AS Date?; DECLARE $nights AS Utf8; DECLARE $budget AS Uint64;
      DECLARE $grp AS Utf8; DECLARE $villa AS Utf8; DECLARE $meal AS Utf8;
      DECLARE $reef AS Bool; DECLARE $notes AS Utf8;

      UPSERT INTO leads (id, client, phone, destination, departure_city, depart_date,
                         nights, budget, grp, villa, meal, reef, notes, status, created_at)
      VALUES ($id, $client, $phone, $destination, $departure_city, $depart_date,
              $nights, $budget, $grp, $villa, $meal, $reef, $notes, "new", CurrentUtcTimestamp());
    `;
    await session.executeQuery(query, {
      $id: TypedValues.utf8(id),
      $client: TypedValues.utf8(client),
      $phone: TypedValues.utf8(phone),
      $destination: TypedValues.utf8(String(data.destination || "").slice(0, 200)),
      $departure_city: TypedValues.utf8(String(data.departureCity || "").slice(0, 200)),
      $depart_date: data.departDate ? TypedValues.optional(TypedValues.date(new Date(data.departDate))) : TypedValues.optionalNull(TypedValues.date(new Date(0)).type),
      $nights: TypedValues.utf8(String(data.nights || "").slice(0, 50)),
      $budget: TypedValues.uint64(Math.max(0, parseInt(data.budget, 10) || 0)),
      $grp: TypedValues.utf8(String(data.group || "").slice(0, 200)),
      $villa: TypedValues.utf8(String(data.villa || "").slice(0, 200)),
      $meal: TypedValues.utf8(String(data.meal || "").slice(0, 200)),
      $reef: TypedValues.bool(Boolean(data.reef)),
      $notes: TypedValues.utf8(String(data.notes || "").slice(0, 2000)),
    });
  });

  // Уведомления не должны ронять приём заявки
  try { await notifyTelegram(client); } catch (e) { console.error(e); }
  try { await notifyPush(client); } catch (e) { console.error(e); }

  return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id }) };
};
