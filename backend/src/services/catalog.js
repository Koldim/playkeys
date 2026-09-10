import { pool } from "../db/pool.js";
import { httpError } from "../util.js";

const sseClients = new Set();

const STOCK_SQL = `
  CASE
    WHEN p.type = 'key' THEN (
      SELECT count(*)::int FROM keys k
      WHERE k.sku = p.sku AND k.status = 'available'
    )
    ELSE CASE WHEN p.available THEN 999 ELSE 0 END
  END
`;

function mapProduct(row) {
  const stock = Number(row.stock) || 0;
  return {
    sku: row.sku,
    name: row.name,
    type: row.type,
    price: row.price,
    currency: row.currency,
    image: row.image,
    stock,
    available: row.available !== false,
  };
}

export async function listProducts({ q, type, available, limit = 60, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${String(q).trim()}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.sku ILIKE $${params.length})`);
  }
  if (type) {
    params.push(type);
    where.push(`p.type = $${params.length}`);
  }
  if (available === true || available === "true") {
    where.push(`p.available = true`);
  } else if (available === false || available === "false") {
    where.push(`p.available = false`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 5000);
  const off = Math.max(Number(offset) || 0, 0);
  params.push(lim, off);
  const res = await pool.query(
    `SELECT p.*, ${STOCK_SQL} AS stock
     FROM products p
     ${whereSql}
     ORDER BY p.sku
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return res.rows.map(mapProduct);
}

export async function getPublicProduct(sku) {
  const res = await pool.query(
    `SELECT p.*, ${STOCK_SQL} AS stock
     FROM products p
     WHERE p.sku = $1`,
    [sku]
  );
  return res.rows[0] ? mapProduct(res.rows[0]) : null;
}

export async function catalogSnapshot() {
  // Featured SKUs only; OFFER-* stay in search API.
  const res = await pool.query(
    `SELECT p.sku, p.price, p.available, ${STOCK_SQL} AS stock
     FROM products p
     WHERE p.sku NOT LIKE 'OFFER-%'
     ORDER BY p.sku`
  );
  return res.rows.map((row) => {
    const stock = Number(row.stock) || 0;
    return {
      sku: row.sku,
      price: row.price,
      stock,
      available: row.available !== false,
    };
  });
}

export async function listAlternatives(sku, limit = 3) {
  const res = await pool.query(
    `SELECT p.*, ${STOCK_SQL} AS stock
     FROM products p
     WHERE p.sku <> $1
       AND p.available = true
       AND p.sku NOT LIKE 'OFFER-%'
     ORDER BY p.sku
     LIMIT $2`,
    [sku, 12]
  );
  return res.rows.map(mapProduct).filter((p) => p.available && p.stock > 0).slice(0, limit);
}

export function soldOutError(sku, alternatives) {
  return httpError(409, "sold_out", {
    message: "Товар только что раскупили",
    sku,
    alternatives,
  });
}

export function addSseClient(res) {
  sseClients.add(res);
}

export function removeSseClient(res) {
  sseClients.delete(res);
}

export function publish(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

export async function publishProduct(sku) {
  const product = await getPublicProduct(sku);
  if (!product) return;
  publish("product.updated", {
    sku: product.sku,
    price: product.price,
    stock: product.stock,
    available: product.available,
  });
}

export async function patchProduct(sku, { price, available } = {}) {
  const current = await pool.query(`SELECT * FROM products WHERE sku = $1`, [sku]);
  if (!current.rows[0]) {
    throw httpError(404, "unknown_sku");
  }
  const nextPrice = price == null ? current.rows[0].price : Number(price);
  const nextAvailable =
    available == null
      ? current.rows[0].available
      : available === true || available === "true";
  if (!Number.isFinite(nextPrice) || nextPrice < 0) {
    throw httpError(400, "invalid_price");
  }
  await pool.query(`UPDATE products SET price = $1, available = $2 WHERE sku = $3`, [
    Math.round(nextPrice),
    nextAvailable,
    sku,
  ]);
  await publishProduct(sku);
  return getPublicProduct(sku);
}
