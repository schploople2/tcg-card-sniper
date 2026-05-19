import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { fetchCardPrices } from "../services/pricecharting.js";
import { PRICE_CACHE_TTL_MS } from "../config.js";

export const pricesRouter = Router();
pricesRouter.use(requireAuth);

/**
 * GET /api/prices/:cardId
 * Returns PriceCharting market prices for a watched card.
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

    // Cache miss — fetch from PriceCharting
    const prices = await fetchCardPrices(card.cardName);
    if (!prices) throw new AppError(503, "Could not retrieve price data for this card");

    const expiresAt = new Date(now.getTime() + PRICE_CACHE_TTL_MS);

    const priceCache = await prisma.priceCache.upsert({
      where: { cardId: card.id },
      create: { cardId: card.id, ...prices, expiresAt },
      update: { ...prices, expiresAt, fetchedAt: now },
    });

    res.json({ prices: priceCache, fromCache: false });
  } catch (err) {
    next(err);
  }
});
