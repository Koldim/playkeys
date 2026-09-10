import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";
import { seed } from "./db/seed.js";
import { ordersRouter } from "./routes/orders.js";
import { productsRouter } from "./routes/products.js";
import { promocodesRouter } from "./routes/promocodes.js";
import { eventsRouter } from "./routes/events.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";
import { releaseExpiredHolds } from "./services/hold.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, "../../frontend");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.use("/api/orders", ordersRouter);
app.use("/api/products", productsRouter);
app.use("/api/promocodes", promocodesRouter);
app.use("/api/events", eventsRouter);
app.use("/webhook", webhookRouter);
app.use("/admin", adminRouter);
app.use(express.static(frontendDir));

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: err.message || "internal_error",
    ...(err.extra || {}),
  });
});

async function main() {
  await migrate();
  await seed();
  setInterval(() => {
    releaseExpiredHolds().catch((err) => console.error("hold release", err));
  }, 2000);
  await releaseExpiredHolds();
  app.listen(config.port, () => {
    console.log(`digital-store listening on http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
