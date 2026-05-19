import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { cardsRouter } from "./routes/cards.js";
import { listingsRouter } from "./routes/listings.js";
import { pricesRouter } from "./routes/prices.js";
import { authRouter } from "./routes/auth.js";
import { startRefreshJob } from "./jobs/refreshListings.js";
import { prisma } from "./db.js";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/listings", listingsRouter);
app.use("/api/prices", pricesRouter);

// ── Global error handler — must be last ───────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  // Verify DB connectivity before accepting traffic
  await prisma.$connect();
  console.log("✅  Database connected");

  // Start background cron job (runs every 30 min)
  startRefreshJob();
  console.log("⏰  Listing refresh job scheduled");

  app.listen(config.PORT, () => {
    console.log(`🚀  Server running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
}

main().catch((err) => {
  console.error("❌  Failed to start server:", err);
  process.exit(1);
});
