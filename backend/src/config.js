import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

function num(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : Number(v);
}

export const config = {
  port: num("PORT", 3000),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://store:store@localhost:5432/digital_store",
  adminToken: process.env.ADMIN_TOKEN || "dev-admin-token",
  holdTtlSec: num("HOLD_TTL_SEC", 240),
  supplierClientTimeoutMs: num("SUPPLIER_CLIENT_TIMEOUT_MS", 1500),
  supplierHangMs: num("SUPPLIER_HANG_MS", 4000),
  supplierA: {
    errorRate: num("SUPPLIER_A_ERROR_RATE", 0),
    timeoutRate: num("SUPPLIER_A_TIMEOUT_RATE", 0),
    delayMs: num("SUPPLIER_A_DELAY_MS", 0),
  },
  supplierB: {
    errorRate: num("SUPPLIER_B_ERROR_RATE", 0),
    timeoutRate: num("SUPPLIER_B_TIMEOUT_RATE", 0),
    delayMs: num("SUPPLIER_B_DELAY_MS", 0),
  },
};
