import { pool } from "../db/pool.js";
import { deliver } from "./delivery.js";
import { finalizePromocodeOnPayment } from "./promo.js";
import { holdIsExpired, releaseIfExpiredLocked } from "./hold.js";
import { publishProduct } from "./catalog.js";
import { httpError } from "../util.js";

export async function applyEvent(eventId) {
  const client = await pool.connect();
  let shouldDeliver = false;
  let orderId = null;
  let releasedSku = null;
  let appliedPaid = false;

  try {
    await client.query("BEGIN");
    const evRes = await client.query(
      `SELECT * FROM payment_events WHERE event_id = $1 FOR UPDATE`,
      [eventId]
    );
    const event = evRes.rows[0];
    if (!event) {
      await client.query("ROLLBACK");
      return { pending: false };
    }
    if (event.processed_at) {
      await client.query("COMMIT");
      return { duplicate: true };
    }

    const ordRes = await client.query(
      `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
      [event.order_id]
    );
    let order = ordRes.rows[0];

    if (!order) {
      await client.query("COMMIT");
      return { pending: true };
    }

    orderId = order.id;

    if (holdIsExpired(order) && ["created", "payment_failed"].includes(order.status)) {
      order = await releaseIfExpiredLocked(client, order);
      releasedSku = order.sku;
    }

    if (event.status === "paid") {
      if (order.status === "hold_expired") {
        // After hold release, paid webhook is a no-op (order stays hold_expired).
      } else if (order.hold_expires_at == null && (order.status === "created" || order.status === "payment_failed")) {
        await finalizePromocodeOnPayment(client, order);
        await client.query(
          `UPDATE orders SET status = 'paid', paid_at = now(), error = NULL WHERE id = $1`,
          [order.id]
        );
        shouldDeliver = true;
        appliedPaid = true;
      } else if (order.status === "created" || order.status === "payment_failed") {
        const reserved = await client.query(
          `SELECT id FROM keys WHERE order_id = $1 AND status = 'reserved' FOR UPDATE`,
          [order.id]
        );
        if (reserved.rows[0]) {
          await finalizePromocodeOnPayment(client, order);
          await client.query(
            `UPDATE orders SET status = 'paid', paid_at = now(), error = NULL WHERE id = $1`,
            [order.id]
          );
          shouldDeliver = true;
          appliedPaid = true;
        }
        // No reserved key: keep unpaid, still consume the event.
      } else if (order.status === "paid") {
        shouldDeliver = true;
        appliedPaid = true;
      }
    } else if (event.status === "failed" && order.status === "created") {
      await client.query(
        `UPDATE orders
         SET status = 'payment_failed', failed_at = now(), error = 'payment_failed'
         WHERE id = $1`,
        [order.id]
      );
    }

    await client.query(
      `UPDATE payment_events SET processed_at = now() WHERE event_id = $1`,
      [eventId]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (releasedSku) {
    await publishProduct(releasedSku);
  }

  if (shouldDeliver && orderId) {
    await deliver(orderId);
  }
  return { pending: false, appliedPaid };
}

export async function applyPendingForOrder(orderId) {
  const pending = await pool.query(
    `SELECT event_id
     FROM payment_events
     WHERE order_id = $1 AND processed_at IS NULL
     ORDER BY CASE WHEN status = 'paid' THEN 0 ELSE 1 END, created_at`,
    [orderId]
  );
  for (const row of pending.rows) {
    await applyEvent(row.event_id);
  }
}

export async function handlePaymentWebhook(payload) {
  const eventId = payload?.event_id;
  const orderId = payload?.order_id;
  const status = payload?.status;

  if (!eventId || !orderId || !status) {
    throw httpError(400, "invalid_payload");
  }
  if (!["paid", "failed"].includes(status)) {
    throw httpError(400, "invalid_status");
  }

  const inserted = await pool.query(
    `INSERT INTO payment_events (event_id, order_id, status, payload)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, orderId, status, payload]
  );

  if (inserted.rowCount === 0) {
    const existing = await pool.query(
      `SELECT processed_at FROM payment_events WHERE event_id = $1`,
      [eventId]
    );
    if (existing.rows[0]?.processed_at) {
      await recoverUnfinishedDelivery(orderId);
      return { ok: true, duplicate: true };
    }
  }

  const result = await applyEvent(eventId);
  return { ok: true, duplicate: false, ...result };
}

async function recoverUnfinishedDelivery(orderId) {
  const order = await pool.query(`SELECT status FROM orders WHERE id = $1`, [orderId]);
  if (["paid", "delivering"].includes(order.rows[0]?.status)) {
    await deliver(orderId);
  }
}
