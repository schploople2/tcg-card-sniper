import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { searchCatalog } from "../services/pokemontcg.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

const searchQuerySchema = z.object({
  q: z.string().min(1, "q is required").max(200),
  // Max 100 — accommodates whole subsets like Radiant Collection (57 cards
  // across two sets) without forcing pagination. pokemontcg.io's own page
  // cap is 250, so this is well within bounds.
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/catalog/search?q=<query>&pageSize=<n>
 *
 * Proxies pokemontcg.io card search. Returns trimmed catalog cards (id,
 * name, set, number, rarity, images, available variant keys, full TCGPlayer
 * prices). Auth-gated to stop the endpoint being used as a free proxy.
 *
 * pokemontcg.io has its own per-IP rate limit; if we ever hit it we'll need
 * to swap in a server-side request cache.
 */
catalogRouter.get("/search", async (req, res, next) => {
  try {
    const { q, pageSize } = searchQuerySchema.parse(req.query);
    const results = await searchCatalog(q, pageSize);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/catalog/_admin/sync
 *
 * Fires the full pokemontcg.io → local Card table sync once. Used for
 * cold-start population on first deploy and for manual refresh between
 * the weekly cron windows. Same auth gate (logged-in user) and same
 * idempotency reasoning as the snapshot admin endpoint.
 *
 * Returns 202 immediately; the job logs progress and the caller can
 * poll GET /api/catalog/status to see when it finishes.
 */
catalogRouter.post("/_admin/sync", async (_req, res, next) => {
  try {
    const { runSyncCatalog } = await import("../jobs/syncCatalog.js");
    void runSyncCatalog().catch((err) =>
      console.error("[syncCatalog] admin-trigger error:", err)
    );
    res.status(202).json({ status: "started" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalog/status
 *
 * Lightweight diagnostic: how many cards in the local cache, and when was
 * the most recent sync? Useful for confirming the sync worked + spotting
 * stale caches.
 */
catalogRouter.get("/status", async (_req, res, next) => {
  try {
    const [total, mostRecent] = await Promise.all([
      prisma.card.count(),
      prisma.card.findFirst({
        orderBy: { syncedAt: "desc" },
        select: { syncedAt: true },
      }),
    ]);
    res.json({
      total,
      lastSyncedAt: mostRecent?.syncedAt ?? null,
    });
  } catch (err) {
    next(err);
  }
});
