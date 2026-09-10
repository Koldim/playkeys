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

async function main() {
  console.log("pay-idempotency against", BASE);
  const health = await api("/health");
  assert(health.status === 200 && health.body.ok, "backend is not running", health);
  await ensureKeys("KEY-CS2-PRIME", 1);

  const idem = `idem_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const payload = { sku: "KEY-CS2-PRIME" };
  const [a, b] = await Promise.all([
    api("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idem },
      body: JSON.stringify(payload),
    }),
    api("/api/orders", {
      method: "POST",
      headers: { "Idempotency-Key": idem },
      body: JSON.stringify(payload),
    }),
  ]);
  assert(a.status === 201 && b.status === 201, "both creates 201", { a, b });
  assert(a.body.order_id === b.body.order_id, "same order", { a: a.body, b: b.body });

  const pay1 = await api(`/api/orders/${a.body.order_id}/pay`, {
    method: "POST",
    body: JSON.stringify({ success: true }),
  });
  const pay2 = await api(`/api/orders/${a.body.order_id}/pay`, {
    method: "POST",
    body: JSON.stringify({ success: true }),
  });
  assert(pay1.status === 200 && pay2.status === 200, "pays 200", { pay1, pay2 });
  const got = await api(`/api/orders/${a.body.order_id}`);
  assert(got.body.status === "delivered", "delivered", got.body);
  assert(got.body.key_code, "key issued", got.body);
  assert(
    pay2.body.order.status === "delivered" && pay2.body.order.key_code === got.body.key_code,
    "second pay is no-op",
    pay2.body
  );
  console.log("ALL PAY IDEMPOTENCY TESTS PASSED", got.body.order_id);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  if (err.extra) console.error(err.extra);
  process.exit(1);
});
