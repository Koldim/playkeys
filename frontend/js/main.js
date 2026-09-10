const catalogBtn = document.querySelector("[data-catalog-btn]");
const catalogMenu = document.querySelector("[data-catalog]");
const carousel = document.querySelector("[data-carousel]");
const slides = [...document.querySelectorAll("[data-slide]")];
const dots = [...document.querySelectorAll("[data-dot]")];
const prevBtn = document.querySelector("[data-prev]");
const nextBtn = document.querySelector("[data-next]");
const currencyBtns = [...document.querySelectorAll("[data-currency]")];
const chipBtns = [...document.querySelectorAll("[data-chip]")];
const promoInput = document.querySelector("[data-promo]");
const promoWrap = document.querySelector("[data-promo-wrap]");
const promoToggle = document.querySelector("[data-promo-toggle]");
const promoApply = document.querySelector("[data-promo-apply]");
const promoMsg = document.querySelector("[data-promo-msg]");
const steamLogin = document.querySelector("[data-steam-login]");
const steamLoginField = document.querySelector("[data-steam-login-field]");
const amountInput = document.querySelector("[data-amount]");
const amountCurrency = document.querySelector("[data-amount-currency]");
const steamPayBtn = document.querySelector("[data-steam-pay]");
const amountRow = document.querySelector("[data-amount-row]");
const amountMirror = document.querySelector("[data-amount-mirror]");
const apiBase = window.DIGITAL_STORE_API || localStorage.getItem("API_URL") || "";
let promoJustToggled = false;
let appliedPromo = null;
const lastProducts = {};

let slide = 0;
let timer;

function setSlide(index) {
  slide = (index + slides.length) % slides.length;
  slides.forEach((el, i) => el.classList.toggle("is-active", i === slide));
  dots.forEach((el, i) => el.classList.toggle("is-active", i === slide));
}

function startCarousel() {
  stopCarousel();
  timer = setInterval(() => setSlide(slide + 1), 4500);
}

function stopCarousel() {
  if (timer) clearInterval(timer);
}

function clipCarouselStage() {
  const stage = carousel?.querySelector(".carousel-stage");
  if (!stage) return;
  const w = stage.offsetWidth;
  const h = stage.offsetHeight;
  if (!w || !h) return;
  const path = [
    `M${w - 110} 0`,
    `C${w - 103.37} 0 ${w - 98} 5.37258 ${w - 98} 12`,
    "V26",
    `C${w - 98} 38.1503 ${w - 88.15} 48 ${w - 76} 48`,
    `H${w - 12}`,
    `C${w - 5.37} 48 ${w} 53.3726 ${w} 60`,
    `V${h - 12}`,
    `C${w} ${h - 5.373} ${w - 5.37} ${h} ${w - 12} ${h}`,
    `H12`,
    `C5.37258 ${h} 0 ${h - 5.373} 0 ${h - 12}`,
    "V12",
    "C0 5.37258 5.37258 0 12 0",
    `H${w - 110}Z`,
  ].join("");
  stage.style.clipPath = `path('${path}')`;
}

if (carousel) {
  clipCarouselStage();
  new ResizeObserver(clipCarouselStage).observe(carousel);

  prevBtn?.addEventListener("click", () => {
    setSlide(slide - 1);
    startCarousel();
  });
  nextBtn?.addEventListener("click", () => {
    setSlide(slide + 1);
    startCarousel();
  });
  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      setSlide(i);
      startCarousel();
    });
  });
  carousel.addEventListener("mouseenter", stopCarousel);
  carousel.addEventListener("mouseleave", startCarousel);
  setSlide(0);
  startCarousel();
}

function closeCatalog() {
  catalogMenu?.classList.remove("is-open");
  catalogBtn?.classList.remove("is-open");
  catalogBtn?.setAttribute("aria-expanded", "false");
}

function closePromo() {
  promoWrap?.classList.remove("is-open");
  promoToggle?.setAttribute("aria-expanded", "false");
}

function currentCurrency() {
  return document.querySelector("[data-currency].is-active")?.dataset.currency || "$";
}

function currentAmount() {
  const raw = String(amountInput?.value || "").replace(",", ".").replace(/[^\d.]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function discountedAmount(price, promo) {
  if (!promo) return price;
  if (promo.type === "percent") {
    return Math.max(0, Math.round(price * (1 - promo.value / 100)));
  }
  return Math.max(0, price - promo.value);
}

function payableAmount() {
  const amount = currentAmount();
  if (amount == null) return null;
  return discountedAmount(amount, appliedPromo);
}

function updatePayLabel() {
  const symbol = currentCurrency();
  const empty = !amountInput?.value.trim();
  amountRow?.classList.toggle("is-empty", empty);
  if (amountMirror) amountMirror.textContent = amountInput?.value || "";
  if (amountCurrency) amountCurrency.textContent = symbol;
  const amount = payableAmount();
  if (steamPayBtn) {
    steamPayBtn.textContent = amount == null ? "Оплатить" : `Оплатить ${amount}${symbol}`;
  }
}

function setPromoMessage(text, kind) {
  if (!promoMsg) return;
  promoMsg.hidden = !text;
  promoMsg.textContent = text || "";
  promoMsg.classList.toggle("is-error", kind === "error");
  promoMsg.classList.toggle("is-ok", kind === "ok");
}

function setAppliedPromo(promo) {
  appliedPromo = promo;
  promoToggle?.classList.toggle("is-applied", Boolean(promo));
  const label = document.querySelector("[data-promo-label]");
  if (label) label.textContent = promo ? promo.code : "Ввести промокод";
  updatePayLabel();
}

function promoErrorText(code) {
  if (code === "promo_exhausted") return "Промокод больше нельзя использовать";
  if (code === "unknown_promocode") return "Промокод не найден";
  return "Не удалось применить промокод";
}

catalogBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  const open = !catalogMenu.classList.contains("is-open");
  catalogMenu.classList.toggle("is-open", open);
  catalogBtn.classList.toggle("is-open", open);
  catalogBtn.setAttribute("aria-expanded", String(open));
});

promoToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  const open = !promoWrap.classList.contains("is-open");
  promoWrap.classList.toggle("is-open", open);
  promoToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    promoJustToggled = true;
    requestAnimationFrame(() => promoInput?.focus());
    setTimeout(() => {
      promoJustToggled = false;
    }, 100);
  }
});

promoApply?.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const code = promoInput?.value.trim();
  if (!code) {
    setAppliedPromo(null);
    setPromoMessage("Введите промокод", "error");
    return;
  }
  promoApply.disabled = true;
  setPromoMessage("");
  try {
    const res = await fetch(`${apiBase}/api/promocodes/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, amount: currentAmount() ?? 500 }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "unknown_promocode");
    if (promoInput) promoInput.value = body.code;
    setAppliedPromo(body);
    setPromoMessage("Промокод применён", "ok");
    closePromo();
  } catch (err) {
    setAppliedPromo(null);
    setPromoMessage(promoErrorText(err.message), "error");
  } finally {
    promoApply.disabled = false;
  }
});

promoInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    promoApply?.click();
  }
});

promoInput?.addEventListener("input", () => {
  if (appliedPromo && promoInput.value.trim().toUpperCase() !== appliedPromo.code) {
    setAppliedPromo(null);
    setPromoMessage("");
  }
});

document.addEventListener("click", (e) => {
  if (!catalogMenu?.contains(e.target) && !catalogBtn?.contains(e.target)) {
    closeCatalog();
  }
  if (promoJustToggled) return;
  if (promoWrap && !e.target.closest("[data-promo-wrap]")) {
    closePromo();
  }
});

currencyBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    currencyBtns.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    updatePayLabel();
  });
});

amountInput?.addEventListener("input", () => {
  amountInput.value = amountInput.value.replace(/[^\d.,]/g, "");
  updatePayLabel();
});

async function postJson(path, payload, headers = {}) {
  const res = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "запрос не выполнен");
  return body;
}

function resetStorefrontButtons() {
  if (steamPayBtn) steamPayBtn.disabled = false;
  document.querySelectorAll("[data-buy]").forEach((btn) => {
    const sku = btn.closest("[data-sku]")?.dataset.sku;
    if (sku && lastProducts[sku]) {
      applyProduct(lastProducts[sku]);
    } else if (!btn.classList.contains("is-sold")) {
      btn.disabled = false;
    }
  });
  updatePayLabel();
}

function setSteamLoginError(on) {
  steamLoginField?.classList.toggle("is-error", on);
  steamLogin?.setAttribute("aria-invalid", on ? "true" : "false");
}

steamLogin?.addEventListener("input", () => {
  if (steamLoginField?.classList.contains("is-error")) setSteamLoginError(false);
});

steamPayBtn?.addEventListener("click", async () => {
  const login = steamLogin?.value.trim();
  if (!login) {
    setSteamLoginError(true);
    steamLogin?.focus();
    return;
  }
  setSteamLoginError(false);
  const amount = currentAmount();
  if (amount == null) {
    amountInput?.focus();
    return;
  }
  const sku = amount >= 2500 ? "STEAM-TOPUP-2500" : amount >= 1000 ? "STEAM-TOPUP-1000" : "STEAM-TOPUP-500";
  steamPayBtn.disabled = true;
  try {
    const payload = { sku };
    if (appliedPromo?.code) payload.promocode = appliedPromo.code;
    const created = await postJson("/api/orders", payload, { "Idempotency-Key": idemKey(sku) });
    const params = new URLSearchParams({ id: created.order_id, login });
    location.href = `order.html?${params}`;
  } catch (err) {
    steamPayBtn.disabled = false;
    steamPayBtn.textContent = err.message;
    setTimeout(updatePayLabel, 1600);
  }
});

chipBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    chipBtns.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    if (!btn.hasAttribute("data-search-type")) return;
    const type = btn.getAttribute("data-search-type") || "";
    writeSearchParams({ q: searchInput?.value.trim() || searchParamsFromUrl().q, type });
    runSearch();
  });
});

function syncChipsFromUrl() {
  const { type } = searchParamsFromUrl();
  const match = chipBtns.find((b) => b.getAttribute("data-search-type") === type);
  if (!match) return;
  chipBtns.forEach((b) => b.classList.remove("is-active"));
  match.classList.add("is-active");
}

document.querySelectorAll(".catalog-side button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".catalog-side button").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
  });
});

document.querySelectorAll("[data-buy]").forEach((btn) => {
  btn.addEventListener("click", () => buyProduct(btn));
});

function formatMoney(price, currency = "RUB") {
  const n = Number(price) || 0;
  const formatted = n.toLocaleString("ru-RU");
  if (currency === "RUB") return `${formatted} ₽`;
  return `${formatted} ${currency}`;
}

function canBuyProduct(p) {
  return Boolean(p) && p.available !== false && Number(p.stock) > 0;
}

function applyProduct(p) {
  if (!p?.sku) return;
  document.querySelectorAll(`[data-sku="${p.sku}"]`).forEach((card) => {
    const priceEl = card.querySelector("[data-price]");
    if (priceEl) priceEl.textContent = formatMoney(p.price, p.currency);
    const strike = card.querySelector(".price s");
    if (strike) strike.hidden = true;
    const stockEl = card.querySelector("[data-stock]");
    if (stockEl) {
      stockEl.textContent = card.dataset.type === "key" || p.type === "key" ? `осталось ${p.stock}` : "";
    }
    const btn = card.querySelector("[data-buy]");
    if (btn && btn.dataset.busy !== "1") {
      const sold = !canBuyProduct(p);
      btn.disabled = sold;
      btn.classList.toggle("is-sold", sold);
      btn.textContent = sold ? "Нет в наличии" : "Купить";
    }
  });
}

function idemKey(sku) {
  const k = `idem:${sku}`;
  let v = sessionStorage.getItem(k);
  if (!v) {
    v = `idem_${sku}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(k, v);
  }
  return v;
}

function showSoldOut(card, body) {
  const err = card?.querySelector("[data-buy-error]");
  if (err) err.textContent = body.message || "Товар только что раскупили";
  card?.querySelector(".sold-alts")?.remove();
  const alts = body.alternatives || [];
  if (!alts.length || !card) return;
  const wrap = document.createElement("div");
  wrap.className = "sold-alts";
  wrap.innerHTML = alts
    .map((a) => `<a href="#${a.sku}">${a.name || a.sku}</a>`)
    .join("");
  wrap.querySelectorAll("a").forEach((link, i) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const sku = alts[i].sku;
      document.querySelector(`[data-sku="${sku}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  card.append(wrap);
}

async function buyProduct(btn) {
  const card = btn.closest("[data-sku]") || btn.closest(".card");
  const sku = card?.dataset.sku || "KEY-CS2-PRIME";
  const err = card?.querySelector("[data-buy-error]");
  if (err) err.textContent = "";
  btn.dataset.busy = "1";
  btn.disabled = true;
  try {
    const payload = { sku };
    if (appliedPromo?.code) payload.promocode = appliedPromo.code;
    const res = await fetch(`${apiBase}/api/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idemKey(sku),
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.error === "sold_out") {
      showSoldOut(card, body);
      const buy = card?.querySelector("[data-buy]");
      if (buy) {
        buy.classList.add("is-sold");
        buy.disabled = true;
        buy.textContent = "Нет в наличии";
      }
      if (body.sku && lastProducts[body.sku]) {
        lastProducts[body.sku] = { ...lastProducts[body.sku], stock: 0 };
      }
      return;
    }
    if (!res.ok) throw new Error(body.error || "не удалось создать заказ");
    location.href = `order.html?id=${encodeURIComponent(body.order_id)}`;
  } catch (e) {
    if (err) err.textContent = e.message;
  } finally {
    btn.dataset.busy = "0";
    if (btn.classList.contains("is-sold")) btn.disabled = true;
    else btn.disabled = false;
  }
}

let searchTimer = null;
let searchAbort = null;
let searchSeq = 0;
let lastSearchHtml = "";
let sseReconnectTimer = null;
const searchForm = document.querySelector("[data-search-form]");
const searchInput = document.querySelector("[data-search-q]");
const searchClearInput = document.querySelector("[data-search-clear-input]");
const searchResults = document.querySelector("[data-search-results]");
const searchCards = document.querySelector("[data-search-cards]");
const searchEmpty = document.querySelector("[data-search-empty]");

function syncSearchClearBtn() {
  if (!searchClearInput || !searchInput) return;
  searchClearInput.hidden = !searchInput.value.trim();
}

function searchParamsFromUrl() {
  const params = new URLSearchParams(location.search);
  return { q: params.get("q") || "", type: params.get("type") || "" };
}

function writeSearchParams({ q, type }) {
  const params = new URLSearchParams(location.search);
  if (q) params.set("q", q);
  else params.delete("q");
  if (type) params.set("type", type);
  else params.delete("type");
  const qs = params.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderSearchCards(products) {
  if (!searchCards) return;
  const html = products
    .map(
      (p) => `
      <article class="card" data-sku="${escapeHtml(p.sku)}" data-type="${escapeHtml(p.type)}">
        <div class="cover" style="background-image:url('${escapeHtml(p.image || "assets/cover.png")}')"></div>
        <h3>${escapeHtml(p.name)}</h3>
        <div class="price"><b data-price>${formatMoney(p.price, p.currency)}</b></div>
        <p class="stock" data-stock>${p.type === "key" ? `осталось ${Number(p.stock) || 0}` : ""}</p>
        <button class="buy" type="button" data-buy>Купить</button>
        <div class="buy-error" data-buy-error></div>
      </article>`
    )
    .join("");
  if (html === lastSearchHtml) return;
  lastSearchHtml = html;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  searchCards.replaceChildren(...tmp.children);
  searchCards.querySelectorAll("[data-buy]").forEach((btn) => {
    btn.addEventListener("click", () => buyProduct(btn));
    const sku = btn.closest("[data-sku]")?.dataset.sku;
    if (sku && lastProducts[sku]) applyProduct(lastProducts[sku]);
  });
}

async function runSearch() {
  const { q, type } = searchParamsFromUrl();
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== q) {
    searchInput.value = q;
  }
  if (!q && !type) {
    searchResults.hidden = true;
    lastSearchHtml = "";
    if (searchCards) searchCards.replaceChildren();
    if (searchEmpty) searchEmpty.hidden = true;
    return;
  }
  searchResults.hidden = false;
  const seq = ++searchSeq;
  searchAbort?.abort();
  searchAbort = new AbortController();
  const params = new URLSearchParams({ limit: "24" });
  if (q) params.set("q", q);
  if (type) params.set("type", type);
  try {
    const res = await fetch(`${apiBase}/api/products?${params}`, { signal: searchAbort.signal });
    const body = await res.json();
    if (seq !== searchSeq) return;
    const products = body.products || [];
    products.forEach((p) => {
      lastProducts[p.sku] = p;
    });
    renderSearchCards(products);
    if (searchEmpty) searchEmpty.hidden = products.length > 0;
    ensureSearchVisible();
  } catch (err) {
    if (err.name === "AbortError") return;
  }
}

function ensureSearchVisible() {
  if (!searchResults || searchResults.hidden) return;
  const headerH = document.querySelector(".header")?.offsetHeight || 80;
  const rect = searchResults.getBoundingClientRect();
  const comfortablyVisible = rect.top >= headerH - 4 && rect.top < window.innerHeight * 0.45;
  if (comfortablyVisible) return;
  searchResults.scrollIntoView({ behavior: "smooth", block: "start" });
}

searchForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  writeSearchParams({ q: searchInput?.value.trim() || "", type: searchParamsFromUrl().type });
  syncSearchClearBtn();
  runSearch();
});

searchInput?.addEventListener("input", () => {
  syncSearchClearBtn();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    writeSearchParams({ q: searchInput.value.trim(), type: searchParamsFromUrl().type });
    runSearch();
  }, 200);
});

searchClearInput?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  syncSearchClearBtn();
  writeSearchParams({ q: "", type: searchParamsFromUrl().type });
  runSearch();
  searchInput?.focus();
});

document.querySelector("[data-search-clear]")?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  syncSearchClearBtn();
  writeSearchParams({ q: "", type: "" });
  syncChipsFromUrl();
  runSearch();
});

function refetchFeaturedCatalog() {
  fetch(`${apiBase}/api/products?limit=100`)
    .then((r) => r.json())
    .then((body) => {
      (body.products || [])
        .filter((p) => !String(p.sku).startsWith("OFFER-"))
        .forEach((p) => {
          lastProducts[p.sku] = p;
          applyProduct(p);
        });
    })
    .catch(() => {});
}

function connectSse() {
  const es = new EventSource(`${apiBase}/api/events`);
  es.addEventListener("catalog.snapshot", (ev) => {
    const data = JSON.parse(ev.data);
    (data.products || []).forEach((p) => {
      lastProducts[p.sku] = { ...lastProducts[p.sku], ...p };
      applyProduct(lastProducts[p.sku]);
    });
  });
  es.addEventListener("product.updated", (ev) => {
    const p = JSON.parse(ev.data);
    lastProducts[p.sku] = { ...lastProducts[p.sku], ...p };
    applyProduct(lastProducts[p.sku]);
  });
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return;
    if (sseReconnectTimer) return;
    sseReconnectTimer = setTimeout(() => {
      sseReconnectTimer = null;
      sse = connectSse();
      refetchFeaturedCatalog();
    }, 2000);
  };
  return es;
}

let sse = connectSse();
window.addEventListener("online", () => {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
  try {
    sse.close();
  } catch {
    /* ignore */
  }
  sse = connectSse();
  refetchFeaturedCatalog();
});

refetchFeaturedCatalog();
syncSearchClearBtn();
syncChipsFromUrl();
runSearch();

setInterval(refetchFeaturedCatalog, 3000);

window.addEventListener("pageshow", resetStorefrontButtons);
updatePayLabel();
