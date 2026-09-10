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

async function ensureKeys(sku, n) {
  const got = await api(`/api/products/${sku}`);
  const need = n - Number(got.body.stock || 0);
  if (need <= 0) return;
  const codes = Array.from({ length: need }, (_, i) =>
    `${sku}-${Date.now().toString(16)}-${i}-${Math.random().toString(16).slice(2, 6)}`.toUpperCase()
  );
  const restock = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sku, codes }),
  });
  assert(restock.status === 200 && restock.body.inserted >= need, "restock", restock);
}

async function createOrder(sku = "KEY-CS2-PRIME") {
  const { status, body } = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ sku }),
  });
  assert(status === 201, "create order failed", { status, body });
  return body;
}

async function sendWebhook(payload) {
  return api("/webhook/payment", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function paidPayload(orderId, eventId, amount = 1290) {
  return {
    event_id: eventId,
    order_id: orderId,
    status: "paid",
    amount,
    currency: "RUB",
    created_at: new Date().toISOString(),
  };
}

async function testParallelUniqueEvents() {
  const order = await createOrder();
  const payloads = Array.from({ length: 50 }, (_, i) =>
    paidPayload(order.order_id, `evt_race_${order.order_id}_${i}`)
  );
  const results = await Promise.all(payloads.map(sendWebhook));
  assert(
    results.every((r) => r.status === 200),
    "all webhooks must return 200",
    { statuses: results.map((r) => r.status) }
  );

  const got = await api(`/api/orders/${order.order_id}`);
  assert(got.body.status === "delivered", "order must be delivered", got.body);
  assert(got.body.key_code, "key_code must be set", got.body);

  const second = await api(`/api/orders/${(await createOrder()).order_id}`);
  void second;

  const again = await api(`/api/orders/${order.order_id}`);
  assert(again.body.key_code === got.body.key_code, "key must stay the same", {
    first: got.body.key_code,
    second: again.body.key_code,
  });

  console.log("  ok  50 unique event_id → 1 delivered, key", got.body.key_code);
  return got.body;
}

async function testDuplicateEventId() {
  const order = await createOrder();
  const eventId = `evt_dup_${order.order_id}`;
  const payload = paidPayload(order.order_id, eventId);
  const results = await Promise.all(Array.from({ length: 50 }, () => sendWebhook(payload)));
  assert(
    results.every((r) => r.status === 200),
    "duplicate webhooks must return 200"
  );

  const got = await api(`/api/orders/${order.order_id}`);
  assert(got.body.status === "delivered", "duplicate event still delivers once", got.body);

  const replay = await sendWebhook(payload);
  assert(replay.status === 200 && replay.body.duplicate === true, "replay must be no-op", replay);
  const after = await api(`/api/orders/${order.order_id}`);
  assert(after.body.key_code === got.body.key_code, "replay must not change key");
  console.log("  ok  50x same event_id → no-op after first, key", got.body.key_code);
}

async function testEmptyPoolAndRetry() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE keys SET status = 'delivered' WHERE sku = 'KEY-GTA5' AND status IN ('available', 'reserved')`
    );
  } finally {
    await client.end();
  }

  const empty = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ sku: "KEY-GTA5" }),
  });
  assert(empty.status === 409 && empty.body.error === "sold_out", "empty pool → 409 sold_out", empty);
  assert(!empty.body.order_id, "no payable order on sold_out", empty.body);

  const code = `GTA5-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toUpperCase();
  const restock = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sku: "KEY-GTA5", codes: [code] }),
  });
  assert(restock.status === 200 && restock.body.inserted >= 1, "restock failed", restock);

  const order = await createOrder("KEY-GTA5");
  const pay = await api(`/api/orders/${order.order_id}/pay`, {
    method: "POST",
    body: JSON.stringify({ success: true }),
  });
  assert(pay.status === 200, "pay must not 500", pay);
  const got = await api(`/api/orders/${order.order_id}`);
  assert(got.body.status === "delivered", "restock then buy delivers", got.body);
  assert(got.body.key_code === code, "must consume the restocked key", got.body);

  const retry2 = await api(`/admin/orders/${order.order_id}/retry-delivery`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert(retry2.body.key_code === got.body.key_code, "retry must be idempotent", retry2.body);
  console.log("  ok  sold_out on empty pool, restock → one key", got.body.key_code);
}

async function main() {
  console.log("race-test against", BASE);
  const health = await api("/health");
  assert(health.status === 200 && health.body.ok, "backend is not running on " + BASE, health);
  await ensureKeys("KEY-CS2-PRIME", 5);

  await testParallelUniqueEvents();
  await testDuplicateEventId();
  await testEmptyPoolAndRetry();
  console.log("ALL RACE TESTS PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
