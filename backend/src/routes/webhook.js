import { Router } from "express";
import { handlePaymentWebhook } from "../services/payments.js";

export const webhookRouter = Router();

webhookRouter.post("/payment", async (req, res, next) => {
  try {
    const result = await handlePaymentWebhook(req.body || {});
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
