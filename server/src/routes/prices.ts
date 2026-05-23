import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { fetchCardById } from "../services/pokemontcg.js";
import { PRICE_CACHE_TTL_MS } from "../config.js";

export const pricesRouter = Router();
pricesRouter.use(requireAuth);

/**
 * GET /api/prices/:cardId
 * Returns the cached TCGPlayer prices (via pokemontcg.io) for a watched card.
 * Serves from the DB cache (6-hour TTL) or fetches fresh on miss.
 */
pricesRouter.get("/:cardId", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
      include: { priceCache: true },
    });
    if (!card) throw new AppError(404, "Card not found");

    const now = new Date();
    const cacheValid = card.priceCache && card.priceCache.expiresAt > now;

    if (cacheValid) {
      return res.json({ prices: card.priceCache, fromCache: true });
    }

    const fresh = await fetchCardById(card.pokemonTcgId);
    if (!fresh || fresh.variants.length === 0) {
      throw new AppError(503, "No TCGPlayer price data available for this card");
    }

    const expiresAt = new Date(now.getTime() + PRICE_CACHE_TTL_MS);
    const variants = fresh.variantPrices as unknown as Prisma.InputJsonValue;
    const priceCache = await prisma.priceCache.upsert({
      where: { cardId: card.id },
      create: { cardId: card.id, variants, expiresAt },
      update: { variants, fetchedAt: now, expiresAt },
    });

    res.json({ prices: priceCache, fromCache: false });
  } catch (err) {
    next(err);
  }
});

const historyQuerySchema = z.object({
  // Days of history to return. Cap at 365 to keep response sizes sane.
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/**
 * GET /api/prices/:cardId/history?days=30
 *
 * Returns ordered price snapshots (oldest → newest) for the chart.
 * Empty array is a valid response — for brand-new cards there's no
 * history yet; the chart should render a flat-line "today only" state
 * until the next snapshot cron lands.
 *
 * The endpoint reads from PriceSnapshot only — it does *not* trigger a
 * fresh fetch. History is built up by the daily cron at 00:05 UTC.
 */
/**
 * POST /api/prices/_admin/snapshot
 *
 * Manually fire the daily price-snapshot job. Useful for backfill on the
 * day a new card is added (so its chart isn't empty until midnight UTC) and
 * for one-off validation after deploys. Gated behind the JWT auth that
 * already covers this router — anyone logged in can trigger it. That's fine
 * because the job is idempotent at the date level (one row per card+variant
 * per day) and the work it does is just snapshot-creation, which is cheap.
 *
 * If/when we add admin roles, this should move behind that gate.
 */
pricesRouter.post("/_admin/snapshot", async (_req, res, next) => {
  try {
    const { runSnapshot } = await import("../jobs/snapshotPrices.js");
    // Fire and return immediately — the job logs its own progress and the
    // caller doesn't need to block (snapshots take a few seconds per card).
    void runSnapshot().catch((err) =>
      console.error("[snapshotJob] admin-trigger error:", err)
    );
    res.status(202).json({ status: "started" });
  } catch (err) {
    next(err);
  }
});

pricesRouter.get("/:cardId/history", async (req, res, next) => {
  try {
    const { days } = historyQuerySchema.parse(req.query);

    // Authz: the user must watch this card. Don't expose other users'
    // history rows even though the snapshots themselves aren't sensitive.
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
      select: { pokemonTcgId: true, variant: true },
    });
    if (!card) throw new AppError(404, "Card not found");

    // Snapshots are catalog-scoped, but stored against a single WatchedCard
    // row at write time (chosen via `distinct` in the cron). When multiple
    // users watch the same card, each has a different WatchedCard.id; the
    // snapshot might belong to *any* of those rows. Resolve every sibling
    // row first, then look up snapshots by the union.
    //
    // Long-term: replace PriceSnapshot.cardId → PriceSnapshot.pokemonTcgId
    // so the model matches the conceptual ownership. For now this stays
    // small and correct.
    const siblings = await prisma.watchedCard.findMany({
      where: { pokemonTcgId: card.pokemonTcgId, variant: card.variant },
      select: { id: true },
    });
    const siblingIds = siblings.map((s) => s.id);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const snapshots = await prisma.priceSnapshot.findMany({
      where: {
        cardId: { in: siblingIds },
        variant: card.variant,
        takenAt: { gte: since },
        // Skip "we tried, nothing found" rows from the chart — they'd
        // render as a $0 dip, which is wrong signal. The user sees a
        // gap in the line for those days, which is honest.
        market: { gt: 0 },
      },
      orderBy: { takenAt: "asc" },
      select: { takenAt: true, market: true, source: true, currency: true },
    });

    // Dedupe: if multiple sibling rows happen to have snapshots from the
    // same day (shouldn't happen with current `distinct` cron behaviour, but
    // belt-and-suspenders), keep the latest per day.
    const byDay = new Map<
      string,
      { takenAt: Date; market: number; source: string; currency: string }
    >();
    for (const s of snapshots) {
      const day = s.takenAt.toISOString().slice(0, 10);
      const existing = byDay.get(day);
      if (!existing || s.takenAt > existing.takenAt) {
        byDay.set(day, {
          takenAt: s.takenAt,
          market: Number(s.market),
          source: s.source,
          currency: s.currency,
        });
      }
    }

    const points = Array.from(byDay.values())
      .sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())
      .map((p) => ({
        date: p.takenAt.toISOString(),
        market: p.market,
        source: p.source,
        currency: p.currency,
      }));

    res.json({
      cardId: req.params.cardId,
      variant: card.variant,
      days,
      points,
    });
  } catch (err) {
    next(err);
  }
});
