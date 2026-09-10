import { Router } from "express";
import { addSseClient, catalogSnapshot, removeSseClient } from "../services/catalog.js";
import { releaseExpiredHolds } from "../services/hold.js";

export const eventsRouter = Router();

eventsRouter.get("/", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(":ok\n\n");

  addSseClient(res);
  try {
    await releaseExpiredHolds();
    const products = await catalogSnapshot();
    res.write(`event: catalog.snapshot\ndata: ${JSON.stringify({ products })}\n\n`);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  const keepAlive = setInterval(() => {
    res.write(":ping\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeSseClient(res);
  });
});
