const statusEl = document.querySelector("[data-status]");
const keyEl = document.querySelector("[data-key]");
const metaEl = document.querySelector("[data-meta]");
const payBtn = document.querySelector("[data-pay]");
const failBtn = document.querySelector("[data-fail]");
const errorEl = document.querySelector("[data-error]");
const keyBox = document.querySelector("[data-key-box]");
const resultEl = document.querySelector("[data-result]");
const holdTimerEl = document.querySelector("[data-hold-timer]");

const params = new URLSearchParams(location.search);
const orderId = params.get("id");
const steamLogin = params.get("login");

function apiBase() {
  return window.DIGITAL_STORE_API || localStorage.getItem("API_URL") || "";
}

async function request(path, options) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || body.error || `http_${res.status}`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

function isKeySku(sku) {
  return String(sku || "").startsWith("KEY-");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clearIdem(sku) {
  if (sku) sessionStorage.removeItem(`idem:${sku}`);
}

let holdDeadline = null;
let holdTick = null;

function formatRemain(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function stopHoldTick() {
  if (holdTick) {
    clearInterval(holdTick);
    holdTick = null;
  }
}

function startHoldTick() {
  stopHoldTick();
  if (!holdTimerEl || !holdDeadline) return;
  const tick = () => {
    const left = holdDeadline - Date.now();
    if (left <= 0) {
      holdTimerEl.hidden = false;
      holdTimerEl.classList.add("is-expired");
      holdTimerEl.textContent = "Бронь снята";
      payBtn.hidden = true;
      failBtn.hidden = true;
      stopHoldTick();
      refresh().catch(() => {});
      return;
    }
    holdTimerEl.hidden = false;
    holdTimerEl.classList.remove("is-expired");
    holdTimerEl.textContent = `Бронь: ${formatRemain(left)}`;
  };
  tick();
  holdTick = setInterval(tick, 250);
}

const STATUS_LABELS = {
  created: "Ожидает оплаты",
  payment_failed: "Оплата не прошла",
  paid: "Оплачен",
  delivering: "Выдача",
  delivered: "Выдан",
  hold_expired: "Бронь снята",
  out_of_stock: "Нет в наличии",
  delivery_failed: "Ошибка выдачи",
};

function render(order) {
  statusEl.textContent = STATUS_LABELS[order.status] || order.status;
  statusEl.dataset.state = order.status;
  metaEl.innerHTML = `
    <div><span>Заказ</span>${order.order_id}</div>
    <div><span>SKU</span>${order.sku}</div>
    <div><span>Сумма</span>${order.amount} ${order.currency}</div>
    ${order.price_changed ? `<div><span>Цена</span>обновлена до оплаты</div>` : ""}
    ${order.promocode ? `<div><span>Промокод</span>${order.promocode}</div>` : ""}
    ${steamLogin && String(order.sku || "").startsWith("STEAM-TOPUP") ? `<div><span>Логин</span>${escapeHtml(steamLogin)}</div>` : ""}
  `;
  const keyProduct = isKeySku(order.sku);
  if (keyProduct && order.key_code) {
    keyBox.hidden = false;
    keyEl.textContent = order.key_code;
  } else {
    keyBox.hidden = true;
    keyEl.textContent = "";
  }

  resultEl.classList.remove("is-warn");
  if (!keyProduct && order.status === "delivered") {
    resultEl.hidden = false;
    resultEl.textContent = steamLogin
      ? `Баланс зачислен на ${steamLogin}`
      : String(order.sku || "").startsWith("STEAM-TOPUP")
        ? "Пополнение выполнено"
        : "Заказ выполнен";
  } else if (order.status === "hold_expired") {
    resultEl.hidden = false;
    resultEl.classList.add("is-warn");
    resultEl.textContent = "Бронь снята, товар снова в продаже";
  } else if (order.status === "payment_failed") {
    resultEl.hidden = false;
    resultEl.classList.add("is-warn");
    resultEl.textContent = "Оплата не прошла. Можно повторить, пока действует бронь.";
  } else if (keyProduct && order.status === "delivered") {
    resultEl.hidden = false;
    resultEl.textContent = "Оплата прошла успешно, ключ ниже.";
  } else {
    resultEl.hidden = true;
    resultEl.textContent = "";
  }

  const holdAlive = order.hold_expires_at && new Date(order.hold_expires_at).getTime() > Date.now();
  const canPay =
    order.status === "created" || (order.status === "payment_failed" && holdAlive);
  const canFail = order.status === "created";
  payBtn.hidden = !canPay;
  failBtn.hidden = !canFail;
  payBtn.disabled = false;
  payBtn.textContent = order.status === "payment_failed" ? "Повторить оплату" : "Оплатить";

  if (canPay && holdAlive) {
    holdDeadline = new Date(order.hold_expires_at).getTime();
    startHoldTick();
  } else if (order.hold_expires_at && (order.status === "hold_expired" || !holdAlive)) {
    stopHoldTick();
    if (holdTimerEl) {
      holdTimerEl.hidden = false;
      holdTimerEl.classList.add("is-expired");
      holdTimerEl.textContent = "Бронь снята";
    }
    if (!canPay) {
      payBtn.hidden = true;
      failBtn.hidden = true;
    }
  } else if (["paid", "delivering", "delivered"].includes(order.status)) {
    stopHoldTick();
    if (holdTimerEl) holdTimerEl.hidden = true;
  }

  if (["delivered", "hold_expired", "out_of_stock", "delivery_failed"].includes(order.status)) {
    clearIdem(order.sku);
  }
}

async function refresh() {
  if (!orderId) {
    errorEl.textContent = "Не указан id заказа";
    return null;
  }
  const order = await request(`/api/orders/${orderId}`);
  render(order);
  return order;
}

payBtn?.addEventListener("click", async () => {
  errorEl.textContent = "";
  payBtn.disabled = true;
  try {
    await request(`/api/orders/${orderId}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: true }),
    });
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message;
    payBtn.disabled = false;
    if (err.status === 409) refresh().catch(() => {});
  }
});

failBtn?.addEventListener("click", async () => {
  errorEl.textContent = "";
  try {
    await request(`/api/orders/${orderId}/pay`, {
      method: "POST",
      body: JSON.stringify({ success: false }),
    });
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

refresh().catch((err) => {
  errorEl.textContent = err.message;
});

setInterval(() => {
  refresh().catch(() => {});
}, 1500);
