import { randomBytes } from "crypto";

export function makeId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function httpError(statusCode, message, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.extra = extra;
  return err;
}

export function publicOrder(row) {
  if (!row) return null;
  return {
    order_id: row.id,
    sku: row.sku,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    key_code: row.key_code,
    promocode: row.promocode,
    error: row.error,
    created_at: row.created_at,
    paid_at: row.paid_at,
    delivering_at: row.delivering_at,
    delivered_at: row.delivered_at,
    failed_at: row.failed_at,
    hold_expires_at: row.hold_expires_at,
    price_changed: row.price_changed || false,
  };
}
