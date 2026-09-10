import { Router } from "express";
import { getPublicProduct, listProducts } from "../services/catalog.js";
import { releaseExpiredHolds } from "../services/hold.js";

export const productsRouter = Router();

productsRouter.get("/", async (req, res, next) => {
  try {
    await releaseExpiredHolds();
    const available =
      req.query.available === undefined ? undefined : req.query.available;
    res.json({
      products: await listProducts({
        q: req.query.q,
        type: req.query.type,
        available,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
    });
  } catch (err) {
    next(err);
  }
});

productsRouter.get("/:sku", async (req, res, next) => {
  try {
    await releaseExpiredHolds();
    const product = await getPublicProduct(req.params.sku);
    if (!product) {
      return res.status(404).json({ error: "unknown_sku" });
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});
