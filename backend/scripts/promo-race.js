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
    `${sku}-PROMO-${Date.now().toString(16)}-${i}-${Math.random().toString(16).slice(2, 6)}`.toUpperCase()
  );
  const restock = await api("/admin/keys", {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sku, codes }),
  });
  assert(restock.status === 200 && restock.body.inserted >= need, "restock", restock);
}

async function resetPromos() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    await client.query(`DELETE FROM promo_redemptions WHERE code IN ('ONCEONLY', 'LIMIT3')`);
    await client.query(`UPDATE promocodes SET used_count = 0 WHERE code IN ('ONCEONLY', 'LIMIT3')`);
  } finally {
    await client.end();
  }
}

async function redemptionCount(code) {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  try {
    const res = await client.query(`SELECT count(*)::int AS n FROM promo_redemptions WHERE code = $1`, [
      code,
    ]);
    return res.rows[0].n;
  } finally {
    await client.end();
  }
}

async function payAll(orderIds) {
  return Promise.all(
    orderIds.map((id) =>
      api(`/api/orders/${id}/pay`, {
        method: "POST",
        body: JSON.stringify({ success: true }),
      })
    )
  );
}

async function main() {
  console.log("promo-race against", BASE);
  await ensureKeys("KEY-CS2-PRIME", 40);
  await resetPromos();

  const onceCreates = await Promise.all(
    Array.from({ length: 20 }, () =>
      api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ sku: "KEY-CS2-PRIME", promocode: "ONCEONLY" }),
      })
    )
  );
  assert(
    onceCreates.every((r) => r.status === 201),
    "all ONCEONLY orders must be created",
    { statuses: onceCreates.map((r) => r.status) }
  );
  assert(
    onceCreates.every((r) => r.body.amount === 645),
    "preview discount on create",
    onceCreates.map((r) => r.body.amount)
  );

  const onceIds = onceCreates.map((r) => r.body.order_id);
  await payAll(onceIds);
  const oncePaid = await Promise.all(onceIds.map((id) => api(`/api/orders/${id}`)));
  const onceDiscounted = oncePaid.filter((r) => r.body.amount === 645);
  assert(onceDiscounted.length === 1, "ONCEONLY must apply on pay exactly once", {
    discounted: onceDiscounted.length,
  });
  assert((await redemptionCount("ONCEONLY")) === 1, "ONCEONLY redemption count");

  await resetPromos();

  const limitCreates = await Promise.all(
    Array.from({ length: 10 }, () =>
      api("/api/orders", {
        method: "POST",
        body: JSON.stringify({ sku: "KEY-CS2-PRIME", promocode: "LIMIT3" }),
      })
    )
  );
  assert(
    limitCreates.every((r) => r.status === 201),
    "all LIMIT3 orders must be created",
    { ok: limitCreates.filter((r) => r.status === 201).length }
  );

  const limitIds = limitCreates.map((r) => r.body.order_id);
  await payAll(limitIds);
  const limitPaid = await Promise.all(limitIds.map((id) => api(`/api/orders/${id}`)));
  const limitDiscounted = limitPaid.filter((r) => r.body.amount === Math.round(1290 * 0.75));
  assert(limitDiscounted.length === 3, "LIMIT3 must apply on pay at most 3 times", {
    discounted: limitDiscounted.length,
  });
  assert((await redemptionCount("LIMIT3")) === 3, "LIMIT3 redemption count");

  console.log("ALL PROMO RACE TESTS PASSED");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
