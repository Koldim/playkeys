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

async function main() {
  console.log("pay-vs-expire against", BASE);
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
    await client.query(`UPDATE keys SET status = 'delivered' WHERE sku = $1 AND status = 'available'`, [SKU]);
    const code = `PXE-${Date.now().toString(16)}`.toUpperCase();
    const restock = await api("/admin/keys", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      body: JSON.stringify({ sku: SKU, codes: [code] }),
    });
    assert(restock.status === 200, "restock", restock);

    const created = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify({ sku: SKU }),
    });
    assert(created.status === 201, "create", created);

    // Hold expired mid-pay: must not become paid without goods.
    await client.query(`UPDATE orders SET hold_expires_at = now() - interval '2 seconds' WHERE id = $1`, [
      created.body.order_id,
    ]);

    const pay = await api(`/api/orders/${created.body.order_id}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: true }),
    });
    assert(pay.status === 409, "pay after silent expiry must 409", pay);

    const got = await api(`/api/orders/${created.body.order_id}`);
    assert(got.body.status === "hold_expired", "order must stay hold_expired", got.body);
    assert(!got.body.key_code, "no key without successful pay", got.body);

    const stock = await api(`/api/products/${SKU}`);
    assert(stock.body.stock === 1, "key returned to stock", stock.body);
  } finally {
    await client.end();
  }

  console.log("ALL PAY-VS-EXPIRE TESTS PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
