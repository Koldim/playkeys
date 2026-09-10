import { pool } from "../db/pool.js";
import { publishProduct } from "./catalog.js";

async function releaseOne(client, orderId) {
  await client.query(
    `UPDATE keys
     SET status = 'available', order_id = NULL, reserved_at = NULL
     WHERE order_id = $1 AND status = 'reserved'`,
    [orderId]
  );
  await client.query(
    `UPDATE orders
     SET status = 'hold_expired', error = 'hold_expired'
     WHERE id = $1 AND status IN ('created', 'payment_failed')`,
    [orderId]
  );
}

export function holdIsExpired(order, now = new Date()) {
  if (!order?.hold_expires_at) return false;
  return new Date(order.hold_expires_at).getTime() <= now.getTime();
}

export async function releaseExpiredHolds() {
  const client = await pool.connect();
  const skus = [];
  try {
    await client.query("BEGIN");
    const expired = await client.query(
      `SELECT id, sku
       FROM orders
       WHERE hold_expires_at IS NOT NULL
         AND hold_expires_at <= now()
         AND status IN ('created', 'payment_failed')
       FOR UPDATE SKIP LOCKED`
    );
    for (const order of expired.rows) {
      await releaseOne(client, order.id);
      skus.push(order.sku);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  for (const sku of new Set(skus)) {
    await publishProduct(sku);
  }
  return skus.length;
}

export async function releaseIfExpiredLocked(client, order) {
  if (!holdIsExpired(order) || !["created", "payment_failed"].includes(order.status)) {
    return order;
  }
  await releaseOne(client, order.id);
  const res = await client.query(`SELECT * FROM orders WHERE id = $1`, [order.id]);
  return res.rows[0];
}
