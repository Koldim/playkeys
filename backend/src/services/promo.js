import { pool } from "../db/pool.js";
import { httpError } from "../util.js";

export function discountedAmount(price, promo) {
  if (!promo) return price;
  if (promo.type === "percent") {
    return Math.max(0, Math.round(price * (1 - promo.value / 100)));
  }
  return Math.max(0, price - promo.value);
}

export async function previewPromocode(code, amount) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    throw httpError(400, "unknown_promocode");
  }
  const { rows } = await pool.query(`SELECT * FROM promocodes WHERE code = $1`, [normalized]);
  const promo = rows[0];
  if (!promo) {
    throw httpError(400, "unknown_promocode");
  }
  if (promo.used_count >= promo.max_uses) {
    throw httpError(409, "promo_exhausted");
  }
  const base = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : null;
  return {
    code: promo.code,
    type: promo.type,
    value: promo.value,
    amount: base == null ? null : discountedAmount(base, promo),
  };
}

export async function finalizePromocodeOnPayment(client, order) {
  if (!order.promocode) {
    return order.amount;
  }

  const redeemed = await client.query(
    `SELECT 1 FROM promo_redemptions WHERE order_id = $1`,
    [order.id]
  );
  if (redeemed.rowCount > 0) {
    return order.amount;
  }

  const applied = await client.query(
    `UPDATE promocodes
     SET used_count = used_count + 1
     WHERE code = $1 AND used_count < max_uses
     RETURNING *`,
    [order.promocode]
  );

  const prodRes = await client.query(`SELECT price FROM products WHERE sku = $1`, [order.sku]);
  const fullPrice = prodRes.rows[0]?.price ?? order.amount;

  if (applied.rowCount === 0) {
    await client.query(
      `UPDATE orders SET amount = $1, promocode = NULL WHERE id = $2`,
      [fullPrice, order.id]
    );
    return fullPrice;
  }

  await client.query(`INSERT INTO promo_redemptions (code, order_id) VALUES ($1, $2)`, [
    order.promocode,
    order.id,
  ]);

  const amount = discountedAmount(fullPrice, applied.rows[0]);
  await client.query(`UPDATE orders SET amount = $1 WHERE id = $2`, [amount, order.id]);
  return amount;
}
