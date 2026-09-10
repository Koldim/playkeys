const tokenInput = document.querySelector("[data-token]");
const loadBtn = document.querySelector("[data-load]");
const table = document.querySelector("[data-table]");
const skuInput = document.querySelector("[data-sku]");
const codesInput = document.querySelector("[data-codes]");
const restockBtn = document.querySelector("[data-restock]");
const msg = document.querySelector("[data-msg]");

tokenInput.value = localStorage.getItem("ADMIN_TOKEN") || "dev-admin-token";

function apiBase() {
  return window.DIGITAL_STORE_API || localStorage.getItem("API_URL") || "";
}

async function admin(path, options = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tokenInput.value.trim()}`,
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `http_${res.status}`);
  return body;
}

function show(text) {
  msg.textContent = text;
}

async function load() {
  localStorage.setItem("ADMIN_TOKEN", tokenInput.value.trim());
  show("");
  const data = await admin("/admin/orders?status=out_of_stock,delivery_failed,paid,delivering");
  table.innerHTML = data.orders
    .map(
      (o) => `
      <tr>
        <td>${o.order_id}</td>
        <td>${o.sku}</td>
        <td>${o.status}</td>
        <td>${o.amount} ${o.currency}</td>
        <td>${o.key_code || "—"}</td>
        <td><button data-retry="${o.order_id}">Retry</button></td>
      </tr>`
    )
    .join("") || `<tr><td colspan="6">Нет проблемных заказов</td></tr>`;
}

table?.addEventListener("click", async (e) => {
  const id = e.target.dataset.retry;
  if (!id) return;
  try {
    const order = await admin(`/admin/orders/${id}/retry-delivery`, { method: "POST" });
    show(`retry ${id} → ${order.status} ${order.key_code || ""}`);
    await load();
  } catch (err) {
    show(err.message);
  }
});

loadBtn?.addEventListener("click", () => load().catch((err) => show(err.message)));
restockBtn?.addEventListener("click", async () => {
  try {
    const codes = codesInput.value
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const result = await admin("/admin/keys", {
      method: "POST",
      body: JSON.stringify({ sku: skuInput.value.trim(), codes }),
    });
    show(`добавлено ключей: ${result.inserted}`);
  } catch (err) {
    show(err.message);
  }
});

load().catch((err) => show(err.message));

document.querySelector("[data-patch]")?.addEventListener("click", async () => {
  try {
    const sku = document.querySelector("[data-patch-sku]").value.trim();
    const priceRaw = document.querySelector("[data-patch-price]").value;
    const available = document.querySelector("[data-patch-available]").checked;
    const body = { available };
    if (priceRaw !== "") body.price = Number(priceRaw);
    const product = await admin(`/admin/products/${encodeURIComponent(sku)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    show(`${product.sku}: ${product.price} ${product.currency}, available=${product.available}, stock=${product.stock}`);
  } catch (err) {
    show(err.message);
  }
});
