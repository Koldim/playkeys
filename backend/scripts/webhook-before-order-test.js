import pg from "pg";
import { config } from "../src/config.js";

const BASE = process.env.API_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin-token";

function assert(cond, message, extra) {
  if (!cond) {
    const err = new Error(message);
    err.extra = extra;
    throw err;
  }
}

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  console.log("webhook-before-order-test against", BASE);
  const orderId = `ord_pre_${Date.now().toString(16)}`;
  const eventId = `evt_pre_${orderId}`;

  const webhook = await api("/webhook/payment", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      order_id: orderId,
      status: "paid",
      amount: 1290,
      currency: "RUB",
      created_at: new Date().toISOString(),
    }),
  });
  assert(webhook.status === 200, "webhook before order must be 200", webhook);
  assert(webhook.body.pending === true, "event must stay pending until order exists", webhook.body);

  const missing = await api(`/api/orders/${orderId}`);
  assert(missing.status === 404, "order must not exist yet", missing);

  const code = `PRE-${Date.now().toString(16)}`.toUpperCase();
  const restock = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sku: "KEY-CS2-PRIME", codes: [code] }),
  });
  assert(restock.status === 200, "need an available key for legacy deliver", restock);

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO orders (id, sku, amount, currency, status)
       VALUES ($1, 'KEY-CS2-PRIME', 1290, 'RUB', 'created')`,
      [orderId]
    );
  } finally {
    await client.end();
  }

  const got = await api(`/api/orders/${orderId}`);
  assert(got.status === 200, "order should appear", got);
  assert(got.body.status === "delivered", "pending paid webhook must apply", got.body);
  assert(got.body.key_code, "key must be issued", got.body);

  const replay = await api("/webhook/payment", {
    method: "POST",
    body: JSON.stringify({
      event_id: eventId,
      order_id: orderId,
      status: "paid",
      amount: 1290,
      currency: "RUB",
      created_at: new Date().toISOString(),
    }),
  });
  assert(replay.status === 200 && replay.body.duplicate === true, "replay is no-op", replay);
  const after = await api(`/api/orders/${orderId}`);
  assert(after.body.key_code === got.body.key_code, "no double issue");

  console.log("ALL WEBHOOK-BEFORE-ORDER TESTS PASSED, key", got.body.key_code);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
