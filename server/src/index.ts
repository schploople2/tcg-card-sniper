import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { cardsRouter } from "./routes/cards.js";
import { listingsRouter } from "./routes/listings.js";
import { pricesRouter } from "./routes/prices.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { ebayDeletionRouter } from "./routes/ebayDeletion.js";
import { alertsRouter } from "./routes/alerts.js";
import { lotsRouter } from "./routes/lots.js";
import { settingsRouter } from "./routes/settings.js";
import { savedLotSearchesRouter } from "./routes/savedLotSearches.js";
import { savedLotsRouter } from "./routes/savedLots.js";
import { watchedSellersRouter } from "./routes/watchedSellers.js";
import { pushRouter } from "./routes/push.js";
import { startRefreshJob } from "./jobs/refreshListings.js";
import { startSnapshotJob } from "./jobs/snapshotPrices.js";
import { startSyncCatalogJob } from "./jobs/syncCatalog.js";
import { startAutoOcrJob } from "./jobs/autoOcrLots.js";
import { startSavedSearchRefreshJob } from "./jobs/refreshSavedSearches.js";
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
app.use("/api/catalog", catalogRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/listings", listingsRouter);
app.use("/api/prices", pricesRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/lots", lotsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/saved-lot-searches", savedLotSearchesRouter);
app.use("/api/saved-lots", savedLotsRouter);
app.use("/api/watched-sellers", watchedSellersRouter);
app.use("/api/push", pushRouter);

// eBay Marketplace Account Deletion webhook — NOT under /api so the URL
// stays stable and clearly distinct from the app's own JSON API.
app.use("/ebay/account-deletion", ebayDeletionRouter);

// ── Global error handler — must be last ───────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  // Verify DB connectivity before accepting traffic
  await prisma.$connect();
  console.log("✅  Database connected");

  // Start background cron jobs:
  //   - listing refresh every 30 min (fresh eBay data)
  //   - price snapshot daily at 00:05 UTC (builds the chart history)
  startRefreshJob();
  console.log("⏰  Listing refresh job scheduled");
  startSnapshotJob();
  console.log("📈  Daily price snapshot job scheduled");
  startSyncCatalogJob();
  console.log("📚  Weekly catalog sync job scheduled");
  startAutoOcrJob();
  startSavedSearchRefreshJob();

  app.listen(config.PORT, () => {
    console.log(`🚀  Server running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
}

main().catch((err) => {
  console.error("❌  Failed to start server:", err);
  process.exit(1);
});
