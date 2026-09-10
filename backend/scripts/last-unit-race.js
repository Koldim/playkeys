import pg from "pg";
import { config } from "../src/config.js";

const BASE = process.env.API_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev-admin-token";
const SKU = "KEY-EFT";

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

async function isolateOneKey() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query(
      `UPDATE keys
       SET status = 'available', order_id = NULL, reserved_at = NULL
       WHERE sku = $1 AND status = 'reserved'`,
      [SKU]
    );
    await client.query(
      `UPDATE orders SET status = 'hold_expired', error = 'hold_expired'
       WHERE sku = $1 AND status IN ('created', 'payment_failed')`,
      [SKU]
    );
    await client.query(
      `UPDATE keys SET status = 'delivered' WHERE sku = $1 AND status = 'available'`,
      [SKU]
    );
  } finally {
    await client.end();
  }
  const code = `EFT-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 6)}`.toUpperCase();
  const restock = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sku: SKU, codes: [code] }),
  });
  assert(restock.status === 200 && restock.body.inserted >= 1, "restock failed", restock);
  return code;
}

async function main() {
  console.log("last-unit-race against", BASE);
  const health = await api("/health");
  assert(health.status === 200 && health.body.ok, "backend is not running", health);
  const code = await isolateOneKey();

  const [a, b] = await Promise.all([
    api("/api/orders", { method: "POST", body: JSON.stringify({ sku: SKU }) }),
    api("/api/orders", { method: "POST", body: JSON.stringify({ sku: SKU }) }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert(statuses[0] === 201 && statuses[1] === 409, "one 201 and one 409 sold_out", { a, b });
  const winner = a.status === 201 ? a : b;
  const loser = a.status === 409 ? a : b;
  assert(loser.body.error === "sold_out", "loser sold_out", loser.body);
  assert(loser.body.message, "loser message", loser.body);
  assert(Array.isArray(loser.body.alternatives), "alternatives", loser.body);
  assert(!loser.body.order_id, "loser has no order", loser.body);

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const extra = await client.query(
      `SELECT count(*)::int AS n FROM orders WHERE sku = $1 AND id <> $2 AND status IN ('created', 'paid', 'delivering')`,
      [SKU, winner.body.order_id]
    );
    assert(extra.rows[0].n === 0, "no extra payable orders for the last unit", extra.rows[0]);
  } finally {
    await client.end();
  }

  const pay = await api(`/api/orders/${winner.body.order_id}/pay`, {
    method: "POST",
    body: JSON.stringify({ success: true }),
  });
  assert(pay.status === 200, "winner pay", pay);
  const got = await api(`/api/orders/${winner.body.order_id}`);
  assert(got.body.status === "delivered", "winner delivered", got.body);
  assert(got.body.key_code === code, "winner got the last key", got.body);

  console.log("ALL LAST-UNIT TESTS PASSED, key", got.body.key_code);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
