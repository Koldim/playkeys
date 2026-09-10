import { randomBytes } from "crypto";
import { config } from "../config.js";
import { sleep } from "../util.js";

function genCode() {
  const chunk = () => randomBytes(2).toString("hex").toUpperCase().slice(0, 4);
  return `${chunk()}-${chunk()}-${chunk()}`;
}

export function createSupplier(name, rates) {
  const issued = new Map();

  return {
    name,
    async issue({ request_id, sku, order_id }) {
      if (issued.has(request_id)) {
        return { status: "ok", request_id, code: issued.get(request_id), sku, order_id };
      }

      if (rates.delayMs > 0) {
        await sleep(rates.delayMs);
      }

      const roll = Math.random();
      if (roll < rates.timeoutRate) {
        const code = genCode();
        issued.set(request_id, code);
        await sleep(config.supplierHangMs);
        return { status: "ok", request_id, code, sku, order_id };
      }

      if (roll < rates.timeoutRate + rates.errorRate) {
        const err = new Error("supplier_unavailable");
        err.httpStatus = 503;
        err.payload = { status: "error", reason: "unavailable" };
        throw err;
      }

      const code = genCode();
      issued.set(request_id, code);
      return { status: "ok", request_id, code, sku, order_id };
    },
  };
}
