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

async function stock() {
  const got = await api(`/api/products/${SKU}`);
  assert(got.status === 200, "product", got);
  return got.body.stock;
}

async function main() {
  console.log("hold-expire against", BASE);
  const health = await api("/health");
  assert(health.status === 200 && health.body.ok, "backend is not running", health);

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
    const code = `HOLD-${Date.now().toString(16)}`.toUpperCase();
    const restock = await api("/admin/keys", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ sku: SKU, codes: [code] }),
    });
    assert(restock.status === 200, "restock", restock);
    assert((await stock()) === 1, "stock 1 before hold");

    const created = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ sku: SKU }),
    });
    assert(created.status === 201, "create hold", created);
    assert((await stock()) === 0, "stock 0 while held");

    await client.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [
      created.body.order_id,
    ]);
    await api("/api/products");
    await api(`/api/orders/${created.body.order_id}`);

    assert((await stock()) === 1, "stock back after expiry");
    const expired = await api(`/api/orders/${created.body.order_id}`);
    assert(expired.body.status === "hold_expired", "order hold_expired", expired.body);

    const pay = await api(`/api/orders/${created.body.order_id}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: true }),
    });
    assert(pay.status === 409, "pay after expiry is 409", pay);

    const second = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ sku: SKU }),
    });
    assert(second.status === 201, "second create after expiry", second);

    const fail = await api(`/api/orders/${second.body.order_id}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: false }),
    });
    assert(fail.status === 200, "payment_failed", fail);
    const failed = await api(`/api/orders/${second.body.order_id}`);
    assert(failed.body.status === "payment_failed", "status payment_failed", failed.body);
    assert((await stock()) === 0, "failed pay still holds the key");

    const paid = await api(`/api/orders/${second.body.order_id}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: true }),
    });
    assert(paid.status === 200, "paid after payment_failed", paid);
    const delivered = await api(`/api/orders/${second.body.order_id}`);
    assert(delivered.body.status === "delivered", "payment_failed → paid delivers", delivered.body);
    assert(delivered.body.key_code === code, "same reserved key", delivered.body);
  } finally {
    await client.end();
  }

  const hide = await api("/admin/products/KEY-GTA5", {
    method: "PATCH",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ available: false }),
  });
  assert(hide.status === 200 && hide.body.available === false, "hide product", hide);
  const blocked = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ sku: "KEY-GTA5" }),
  });
  assert(blocked.status === 409 && blocked.body.error === "sold_out", "available=false → sold_out", blocked);
  await api("/admin/products/KEY-GTA5", {
    method: "PATCH",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ available: true }),
  });

  const priceSku = "KEY-CS2-PRIME";
  const restockCs2 = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({
      sku: priceSku,
      codes: [`PRICE-${Date.now().toString(16)}`.toUpperCase()],
    }),
  });
  assert(restockCs2.status === 200, "cs2 restock", restockCs2);
  const before = await api(`/api/products/${priceSku}`);
  const original = before.body.price;
  const bumped = original + 111;
  await api(`/admin/products/${priceSku}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ price: bumped }),
  });
  const open = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({ sku: priceSku }),
  });
  assert(open.status === 201, "create for price persist", open);
  assert(open.body.amount === bumped, "create uses new price", open.body);
  await api(`/admin/products/${priceSku}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ price: bumped + 50 }),
  });
  const refreshed = await api(`/api/orders/${open.body.order_id}`);
  assert(refreshed.body.amount === bumped + 50, "GET persist current price before pay", refreshed.body);
  assert(refreshed.body.price_changed === true, "price_changed flag", refreshed.body);
  await api(`/admin/products/${priceSku}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ price: original }),
  });

  console.log("ALL HOLD-EXPIRE TESTS PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
