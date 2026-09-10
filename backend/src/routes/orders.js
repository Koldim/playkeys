import { Router } from "express";
import { createOrder, getOrder, payOrder } from "../services/orders.js";

export const ordersRouter = Router();

ordersRouter.post("/", async (req, res, next) => {
  try {
    const sku = req.body?.sku;
    if (!sku) {
      return res.status(400).json({ error: "sku_required" });
    }
    const clientRequestId =
      req.headers["idempotency-key"] || req.body?.client_request_id || null;
    const order = await createOrder({
      sku,
      promocode: req.body?.promocode,
      clientRequestId,
    });
    res.status(201).json({
      order_id: order.order_id,
      status: order.status,
      amount: order.amount,
      currency: order.currency,
      hold_expires_at: order.hold_expires_at,
    });
  } catch (err) {
    next(err);
  }
});

ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const order = await getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "order_not_found" });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
});

ordersRouter.post("/:id/pay", async (req, res, next) => {
  try {
    const success = req.body?.success !== false;
    const result = await payOrder(req.params.id, { success });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
