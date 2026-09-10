import { pool } from "../db/pool.js";
import { config } from "../config.js";
import { suppliers } from "../suppliers/index.js";

function timeoutError() {
  const err = new Error("timeout");
  err.code = "TIMEOUT";
  return err;
}

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordRequest(client, { request_id, order_id, supplier, code, status }) {
  await client.query(
    `INSERT INTO delivery_requests (request_id, order_id, supplier, code, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (request_id) DO UPDATE SET
       code = COALESCE(EXCLUDED.code, delivery_requests.code),
       status = EXCLUDED.status,
       updated_at = now()`,
    [request_id, order_id, supplier, code, status]
  );
}

async function issueFromSupplier(client, supplier, order) {
  const requestId = `req_${order.id}-${supplier.name}`;

  const existing = await client.query(
    `SELECT * FROM delivery_requests WHERE request_id = $1`,
    [requestId]
  );
  if (existing.rows[0]?.status === "ok" && existing.rows[0].code) {
    return existing.rows[0].code;
  }

  await recordRequest(client, {
    request_id: requestId,
    order_id: order.id,
    supplier: supplier.name,
    code: existing.rows[0]?.code || null,
    status: "pending",
  });

  try {
    const result = await withTimeout(
      supplier.issue({ request_id: requestId, sku: order.sku, order_id: order.id }),
      config.supplierClientTimeoutMs
    );
    if (result?.status === "ok" && result.code) {
      await recordRequest(client, {
        request_id: requestId,
        order_id: order.id,
        supplier: supplier.name,
        code: result.code,
        status: "ok",
      });
      return result.code;
    }
    await recordRequest(client, {
      request_id: requestId,
      order_id: order.id,
      supplier: supplier.name,
      code: null,
      status: "error",
    });
    return null;
  } catch (err) {
    const status = err.code === "TIMEOUT" ? "timeout" : "error";
    await recordRequest(client, {
      request_id: requestId,
      order_id: order.id,
      supplier: supplier.name,
      code: existing.rows[0]?.code || null,
      status,
    });
    if (status === "timeout") {
      try {
        const retry = await withTimeout(
          supplier.issue({ request_id: requestId, sku: order.sku, order_id: order.id }),
          config.supplierClientTimeoutMs
        );
        if (retry?.status === "ok" && retry.code) {
          await recordRequest(client, {
            request_id: requestId,
            order_id: order.id,
            supplier: supplier.name,
            code: retry.code,
            status: "ok",
          });
          return retry.code;
        }
      } catch {}
    }
    return null;
  }
}

async function attachCode(client, orderId, code) {
  await client.query(
    `UPDATE orders
     SET status = 'delivered',
         key_code = $1,
         delivered_at = now(),
         error = NULL
     WHERE id = $2`,
    [code, orderId]
  );
}

export async function deliver(orderId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ordRes = await client.query(
      `SELECT o.*, p.type AS product_type
       FROM orders o
       JOIN products p ON p.sku = o.sku
       WHERE o.id = $1
       FOR UPDATE OF o`,
      [orderId]
    );
    const order = ordRes.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return null;
    }

    if (order.status === "delivered" && order.key_code) {
      await client.query("COMMIT");
      return order;
    }

    if (!["paid", "delivering", "out_of_stock", "delivery_failed"].includes(order.status)) {
      await client.query("COMMIT");
      return order;
    }

    await client.query(
      `UPDATE orders
       SET status = 'delivering',
           delivering_at = COALESCE(delivering_at, now())
       WHERE id = $1`,
      [orderId]
    );

    const keyRes = order.hold_expires_at
      ? await client.query(
          `SELECT id, code
           FROM keys
           WHERE order_id = $1 AND status = 'reserved'
           FOR UPDATE`,
          [order.id]
        )
      : await client.query(
          `SELECT id, code
           FROM keys
           WHERE sku = $1 AND status = 'available'
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [order.sku]
        );

    if (keyRes.rows[0]) {
      const key = keyRes.rows[0];
      await client.query(
        `UPDATE keys
         SET status = 'delivered', order_id = $1, delivered_at = now()
         WHERE id = $2`,
        [orderId, key.id]
      );
      await attachCode(client, orderId, key.code);
      await client.query("COMMIT");
      return { ...order, status: "delivered", key_code: key.code };
    }

    if (order.product_type === "key") {
      await client.query(
        `UPDATE orders
         SET status = 'out_of_stock', error = 'empty_pool'
         WHERE id = $1`,
        [orderId]
      );
      await client.query("COMMIT");
      return { ...order, status: "out_of_stock", error: "empty_pool" };
    }

    let code = null;
    let lastError = "supplier_failed";
    for (const supplier of suppliers) {
      code = await issueFromSupplier(client, supplier, order);
      if (code) break;
    }

    if (code) {
      await attachCode(client, orderId, code);
      await client.query("COMMIT");
      return { ...order, status: "delivered", key_code: code };
    }

    await client.query(
      `UPDATE orders
       SET status = 'delivery_failed',
           failed_at = now(),
           error = $2
       WHERE id = $1`,
      [orderId, lastError]
    );
    await client.query("COMMIT");
    return { ...order, status: "delivery_failed", error: lastError };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
