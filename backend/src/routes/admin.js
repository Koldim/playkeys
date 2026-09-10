import { Router } from "express";
import { config } from "../config.js";
import { addKeys, listProblemOrders, patchProduct, retryDelivery } from "../services/orders.js";

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== config.adminToken) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

adminRouter.get("/orders", async (req, res, next) => {
  try {
    const raw = String(req.query.status || "out_of_stock,delivery_failed");
    const statuses = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    res.json({ orders: await listProblemOrders(statuses) });
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/orders/:id/retry-delivery", async (req, res, next) => {
  try {
    const order = await retryDelivery(req.params.id);
    res.json(order);
  } catch (err) {
    next(err);
  }
});

adminRouter.post("/keys", async (req, res, next) => {
  try {
    const sku = req.body?.sku;
    const codes = req.body?.codes;
    if (!sku || !Array.isArray(codes) || codes.length === 0) {
      return res.status(400).json({ error: "sku_and_codes_required" });
    }
    res.json(await addKeys(sku, codes));
  } catch (err) {
    next(err);
  }
});

adminRouter.patch("/products/:sku", async (req, res, next) => {
  try {
    const product = await patchProduct(req.params.sku, {
      price: req.body?.price,
      available: req.body?.available,
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
});
