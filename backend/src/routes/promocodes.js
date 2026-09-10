import { Router } from "express";
import { previewPromocode } from "../services/promo.js";

export const promocodesRouter = Router();

promocodesRouter.post("/preview", async (req, res, next) => {
  try {
    const amount = req.body?.amount;
    const parsed = amount == null || amount === "" ? null : Number(amount);
    const preview = await previewPromocode(
      req.body?.code,
      Number.isFinite(parsed) ? parsed : null
    );
    res.json(preview);
  } catch (err) {
    next(err);
  }
});
