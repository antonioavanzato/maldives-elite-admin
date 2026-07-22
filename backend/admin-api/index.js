/* Yandex Cloud Function: API админки.
   POST   /login              — вход { email, password } → { token }
   GET    /leads              — список заявок
   PATCH  /leads/{id}/status  — смена статуса { status }
   DELETE /leads/{id}         — удаление заявки

   Вход: почта и пароль менеджера сверяются с ADMIN_EMAIL / ADMIN_PASSWORD_HASH
   (sha256-хэш пароля, чтобы сам пароль не лежал в настройках открытым текстом).
   Успешный вход возвращает токен сессии, остальные запросы идут с заголовком
   Authorization: Bearer {token}.

   Окружение: YDB_ENDPOINT, YDB_DATABASE, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, SESSION_SECRET. */

const { Driver, getCredentialsFromEnv, TypedValues, TypedData } = require("ydb-sdk");
const { createHash, createHmac, timingSafeEqual } = require("crypto");

const SESSION_DAYS = 90; // сессия живёт 90 дней, потом повторный вход

function makeToken() {
  const exp = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  const sig = createHmac("sha256", process.env.SESSION_SECRET).update(String(exp)).digest("hex");
  return `${exp}.${sig}`;
}

function tokenValid(token) {
  const [exp, sig] = String(token).split(".");
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const good = createHmac("sha256", process.env.SESSION_SECRET).update(exp).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(good, "hex"));
  } catch {
    return false;
  }
}

let driver;
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
  "Access-Control-Allow-Origin": "*", // сузить до домена админки после деплоя
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const STATUSES = new Set(["new", "progress", "confirmed", "closed"]);

function resp(code, body) {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Строка YDB -> объект в формате админки
function toLead(row) {
  return {
    id: row.id,
    client: row.client,
    phone: row.phone,
    destination: row.destination,
    departureCity: row.departure_city,
    departDate: row.depart_date ? new Date(row.depart_date).toISOString().slice(0, 10) : "",
    nights: row.nights,
    budget: Number(row.budget || 0),
    group: row.grp,
    villa: row.villa,
    meal: row.meal,
    reef: Boolean(row.reef),
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };

  const path = event.path || event.url || "";

  // Вход по почте и паролю
  if (event.httpMethod === "POST" && path.endsWith("/login")) {
    let body;
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
    } catch { return resp(400, { error: "invalid json" }); }
    const email = String(body.email || "").trim().toLowerCase();
    const hash = createHash("sha256").update(String(body.password || "")).digest("hex");
    if (email !== String(process.env.ADMIN_EMAIL).toLowerCase() || hash !== process.env.ADMIN_PASSWORD_HASH) {
      return resp(401, { error: "invalid credentials" });
    }
    return resp(200, { token: makeToken() });
  }

  const auth = (event.headers && (event.headers.Authorization || event.headers.authorization)) || "";
  if (!tokenValid(auth.replace(/^Bearer\s+/i, ""))) return resp(401, { error: "unauthorized" });
  const idMatch = path.match(/\/leads\/([^/]+)/);
  const d = await getDriver();

  // Регистрация push-подписки устройства (после разрешения уведомлений в админке).
  // Тело: { endpoint, keys: { p256dh, auth } } — стандартный PushSubscription.
  if (event.httpMethod === "POST" && path.endsWith("/push/subscribe")) {
    let body;
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
    } catch { return resp(400, { error: "invalid json" }); }
    const endpoint = String((body && body.endpoint) || "");
    const keys = (body && body.keys) || {};
    if (!endpoint || !keys.p256dh || !keys.auth) return resp(400, { error: "invalid subscription" });

    await d.tableClient.withSession(async (session) => {
      await session.executeQuery(
        `DECLARE $e AS Utf8; DECLARE $p AS Utf8; DECLARE $a AS Utf8;
         UPSERT INTO push_subs (endpoint, p256dh, auth, created_at)
         VALUES ($e, $p, $a, CurrentUtcTimestamp());`,
        {
          $e: TypedValues.utf8(endpoint),
          $p: TypedValues.utf8(String(keys.p256dh)),
          $a: TypedValues.utf8(String(keys.auth)),
        }
      );
    });
    return resp(200, { ok: true });
  }

  if (event.httpMethod === "GET") {
    let rows = [];
    await d.tableClient.withSession(async (session) => {
      const { resultSets } = await session.executeQuery("SELECT * FROM leads ORDER BY created_at DESC;");
      rows = TypedData.createNativeObjects(resultSets[0]);
    });
    return resp(200, rows.map(toLead));
  }

  if (event.httpMethod === "PATCH" && idMatch && path.endsWith("/status")) {
    let body;
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body);
    } catch { return resp(400, { error: "invalid json" }); }
    if (!STATUSES.has(body.status)) return resp(400, { error: "invalid status" });

    await d.tableClient.withSession(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Utf8; DECLARE $status AS Utf8;
         UPDATE leads SET status = $status WHERE id = $id;`,
        { $id: TypedValues.utf8(idMatch[1]), $status: TypedValues.utf8(body.status) }
      );
    });
    return resp(200, { ok: true });
  }

  if (event.httpMethod === "DELETE" && idMatch) {
    await d.tableClient.withSession(async (session) => {
      await session.executeQuery(
        `DECLARE $id AS Utf8; DELETE FROM leads WHERE id = $id;`,
        { $id: TypedValues.utf8(idMatch[1]) }
      );
    });
    return resp(200, { ok: true });
  }

  return resp(404, { error: "not found" });
};
