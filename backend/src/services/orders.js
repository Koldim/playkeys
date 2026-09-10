import { pool } from "../db/pool.js";
import { previewPromocode } from "./promo.js";
import { applyPendingForOrder, handlePaymentWebhook } from "./payments.js";
import { deliver } from "./delivery.js";
import { holdIsExpired, releaseExpiredHolds, releaseIfExpiredLocked } from "./hold.js";
import {
  listAlternatives,
  patchProduct,
  publishProduct,
  soldOutError,
} from "./catalog.js";
import { config } from "../config.js";
import { httpError, makeId, publicOrder } from "../util.js";

export { patchProduct };

export async function getProduct(sku) {
  const res = await pool.query(`SELECT * FROM products WHERE sku = $1`, [sku]);
  return res.rows[0] || null;
}

function isUniqueViolation(err) {
  return err?.code === "23505";
}

async function insertOrder(client, { orderId, sku, amount, currency, promoCode, holdExpiresAt, clientRequestId }) {
  await client.query(
    `INSERT INTO orders (id, sku, amount, currency, status, promocode, hold_expires_at, client_request_id)
     VALUES ($1, $2, $3, $4, 'created', $5, $6, $7)`,
    [orderId, sku, amount, currency, promoCode, holdExpiresAt, clientRequestId]
  );
}

const TERMINAL_IDEMPOTENCY = new Set([
  "hold_expired",
  "delivered",
  "out_of_stock",
  "delivery_failed",
]);

export async function createOrder({ sku, promocode, clientRequestId }) {
  await releaseExpiredHolds();

  const idem = clientRequestId ? String(clientRequestId).trim() || null : null;
  if (idem) {
    const existing = await pool.query(`SELECT * FROM orders WHERE client_request_id = $1`, [idem]);
    const prev = existing.rows[0];
    if (prev) {
      if (TERMINAL_IDEMPOTENCY.has(prev.status) || holdIsExpired(prev)) {
        await pool.query(`UPDATE orders SET client_request_id = NULL WHERE id = $1`, [prev.id]);
      } else {
        return getOrder(prev.id);
      }
    }
  }

  let amountPreview = null;
  let promoCode = null;
  if (promocode) {
    const productPeek = await getProduct(sku);
    if (!productPeek) throw httpError(404, "unknown_sku");
    const preview = await previewPromocode(promocode, productPeek.price);
    amountPreview = preview.amount;
    promoCode = preview.code;
  }

  const orderId = makeId("ord");
  const client = await pool.connect();
  let productType = null;
  let productSku = sku;
  try {
    await client.query("BEGIN");
    const prodRes = await client.query(`SELECT * FROM products WHERE sku = $1 FOR UPDATE`, [sku]);
    const product = prodRes.rows[0];
    if (!product) {
      throw httpError(404, "unknown_sku");
    }
    productType = product.type;
    productSku = product.sku;

    if (!product.available) {
      throw soldOutError(sku, null);
    }

    const amount = amountPreview != null ? amountPreview : product.price;
    const holdExpiresAt =
      product.type === "key" ? new Date(Date.now() + config.holdTtlSec * 1000) : null;

    await insertOrder(client, {
      orderId,
      sku,
      amount,
      currency: product.currency,
      promoCode,
      holdExpiresAt,
      clientRequestId: idem,
    });

    if (product.type === "key") {
      const keyRes = await client.query(
        `SELECT id
         FROM keys
         WHERE sku = $1 AND status = 'available'
         ORDER BY id
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
        [sku]
      );
      if (!keyRes.rows[0]) {
        throw soldOutError(sku, null);
      }
      await client.query(
        `UPDATE keys
         SET status = 'reserved', order_id = $1, reserved_at = now()
         WHERE id = $2`,
        [orderId, keyRes.rows[0].id]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    if (err?.message === "sold_out") {
      throw soldOutError(sku, await listAlternatives(sku));
    }
    if (idem && isUniqueViolation(err)) {
      const existing = await pool.query(`SELECT * FROM orders WHERE client_request_id = $1`, [idem]);
      if (existing.rows[0]) {
        return getOrder(existing.rows[0].id);
      }
    }
    throw err;
  } finally {
    client.release();
  }

  if (productType === "key") {
    await publishProduct(productSku);
  }
  await applyPendingForOrder(orderId);
  return getOrder(orderId);
}

async function persistCurrentPrice(orderId) {
  const client = await pool.connect();
  let skuToPublish = null;
  let priceChanged = false;
  try {
    await client.query("BEGIN");
    const ordRes = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    let order = ordRes.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return null;
    }
    if (holdIsExpired(order) && ["created", "payment_failed"].includes(order.status)) {
      order = await releaseIfExpiredLocked(client, order);
      skuToPublish = order.sku;
    } else if (order.status === "created") {
      const product = await client.query(`SELECT price FROM products WHERE sku = $1`, [order.sku]);
      const fullPrice = product.rows[0]?.price ?? order.amount;
      let amount = fullPrice;
      if (order.promocode) {
        try {
          const preview = await previewPromocode(order.promocode, fullPrice);
          amount = preview.amount;
        } catch {
          amount = fullPrice;
        }
      }
      if (amount !== order.amount) {
        await client.query(`UPDATE orders SET amount = $1 WHERE id = $2`, [amount, orderId]);
        priceChanged = true;
        order = { ...order, amount };
      }
    }
    await client.query("COMMIT");
    order.price_changed = priceChanged;
    return { order, skuToPublish };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getOrder(orderId) {
  await applyPendingForOrder(orderId);
  const refreshed = await persistCurrentPrice(orderId);
  if (!refreshed) return null;
  if (refreshed.skuToPublish) {
    await publishProduct(refreshed.skuToPublish);
  }
  let order = refreshed.order;
  if (["paid", "delivering"].includes(order.status)) {
    await deliver(orderId);
    const res = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
    order = res.rows[0];
  }
  return publicOrder(order);
}

export async function payOrder(orderId, { success = true } = {}) {
  await releaseExpiredHolds();
  const existing = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  const order = existing.rows[0];
  if (!order) {
    throw httpError(404, "order_not_found");
  }

  if (["paid", "delivering", "delivered"].includes(order.status)) {
    return { event_id: null, order: await getOrder(orderId) };
  }
  if (order.status === "hold_expired" || (holdIsExpired(order) && ["created", "payment_failed"].includes(order.status))) {
    await releaseExpiredHolds();
    throw httpError(409, "hold_expired", { message: "Бронь снята" });
  }

  const live = await persistCurrentPrice(orderId);
  if (!live?.order) {
    throw httpError(404, "order_not_found");
  }
  if (live.order.status === "hold_expired") {
    if (live.skuToPublish) await publishProduct(live.skuToPublish);
    throw httpError(409, "hold_expired", { message: "Бронь снята" });
  }
  const amount = live.order.amount;
  const currency = live.order.currency;

  const event = {
    event_id: makeId("evt"),
    order_id: orderId,
    status: success ? "paid" : "failed",
    amount,
    currency,
    created_at: new Date().toISOString(),
  };

  await handlePaymentWebhook(event);
  const finalOrder = await getOrder(orderId);
  if (success && !["paid", "delivering", "delivered"].includes(finalOrder.status)) {
    if (finalOrder.status === "hold_expired") {
      throw httpError(409, "hold_expired", { message: "Бронь снята", order: finalOrder });
    }
    throw httpError(409, "payment_not_applied", {
      message: "Оплата не применена",
      order: finalOrder,
    });
  }
  return { event_id: event.event_id, order: finalOrder };
}

export async function retryDelivery(orderId) {
  const existing = await pool.query(`SELECT * FROM orders WHERE id = $1`, [orderId]);
  if (!existing.rows[0]) {
    throw httpError(404, "order_not_found");
  }
  await deliver(orderId);
  return getOrder(orderId);
}

export async function listProblemOrders(statuses) {
  const res = await pool.query(
    `SELECT * FROM orders
     WHERE status = ANY($1::text[])
     ORDER BY created_at DESC`,
    [statuses]
  );
  return res.rows.map(publicOrder);
}

export async function addKeys(sku, codes) {
  const product = await getProduct(sku);
  if (!product) {
    throw httpError(404, "unknown_sku");
  }
  let inserted = 0;
  for (const code of codes) {
    const result = await pool.query(
      `INSERT INTO keys (sku, code, status)
       VALUES ($1, $2, 'available')
       ON CONFLICT (code) DO NOTHING`,
      [sku, String(code).trim()]
    );
    inserted += result.rowCount;
  }
  await publishProduct(sku);
  return { sku, inserted, requested: codes.length };
}
