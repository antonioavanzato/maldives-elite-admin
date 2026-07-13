/* Yandex Cloud Function: API админки.
   GET    /leads              — список заявок
   PATCH  /leads/{id}/status  — смена статуса { status }
   DELETE /leads/{id}         — удаление заявки

   Доступ по заголовку Authorization: Bearer {ADMIN_TOKEN}.
   Окружение: YDB_ENDPOINT, YDB_DATABASE, ADMIN_TOKEN. */

const { Driver, getCredentialsFromEnv, TypedValues, TypedData } = require("ydb-sdk");

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
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
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

  const auth = (event.headers && (event.headers.Authorization || event.headers.authorization)) || "";
  if (auth !== `Bearer ${process.env.ADMIN_TOKEN}`) return resp(401, { error: "unauthorized" });

  const path = event.path || event.url || "";
  const idMatch = path.match(/\/leads\/([^/]+)/);
  const d = await getDriver();

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
