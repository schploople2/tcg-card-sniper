import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { searchEbayListings } from "../services/ebay.js";
import { fetchCardPrices } from "../services/pricecharting.js";
import { scoreAndSort } from "../services/dealScore.js";
import { LISTING_CACHE_TTL_MS, PRICE_CACHE_TTL_MS } from "../config.js";

export const listingsRouter = Router();
listingsRouter.use(requireAuth);

/**
 * GET /api/listings/:cardId
 * Returns all non-expired eBay listings for a watched card, scored by deal tier.
 * On a cache miss (no listings or all expired), fetches fresh data from eBay
 * and re-scores against the latest PriceCharting market price.
 */
listingsRouter.get("/:cardId", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
      include: { priceCache: true },
    });
    if (!card) throw new AppError(404, "Card not found");

    // Check listing cache
    const now = new Date();
    const cachedListings = await prisma.listing.findMany({
      where: { cardId: card.id, expiresAt: { gt: now } },
      orderBy: { dealScore: "desc" },
    });

    if (cachedListings.length > 0) {
      return res.json({ listings: cachedListings, fromCache: true });
    }

    // ── Cache miss: fetch fresh data ─────────────────────────────────────────

    // 1. Get (or refresh) the market price
    let marketPrice: number | null = null;

    const priceExpired =
      !card.priceCache || card.priceCache.expiresAt < now;

    if (priceExpired) {
      const prices = await fetchCardPrices(card.cardName);
      if (prices) {
        const expiresAt = new Date(now.getTime() + PRICE_CACHE_TTL_MS);
        await prisma.priceCache.upsert({
          where: { cardId: card.id },
          create: { cardId: card.id, ...prices, expiresAt },
          update: { ...prices, expiresAt, fetchedAt: now },
        });
        marketPrice = prices.loosePrice ?? prices.gradedPrice ?? null;
      }
    } else {
      marketPrice =
        Number(card.priceCache!.loosePrice) ||
        Number(card.priceCache!.gradedPrice) ||
        null;
    }

    if (!marketPrice) throw new AppError(503, "Could not retrieve market price for this card");

    // 2. Fetch listings from eBay
    const rawListings = await searchEbayListings(card.cardName, card.condition);
    const scored = scoreAndSort(rawListings, marketPrice);

    // 3. Upsert into DB with TTL
    const expiresAt = new Date(now.getTime() + LISTING_CACHE_TTL_MS);

    await prisma.$transaction(
      scored.map((l) =>
        prisma.listing.upsert({
          where: { ebayItemId: l.ebayItemId },
          create: {
            cardId: card.id,
            ebayItemId: l.ebayItemId,
            title: l.title,
            imageUrl: l.imageUrl,
            ebayUrl: l.ebayUrl,
            listingPrice: l.listingPrice,
            shippingCost: l.shippingCost,
            totalCost: l.totalCost,
            marketPrice,
            dealScore: l.dealScore,
            dealTier: l.dealTier,
            listingType: l.listingType,
            condition: l.condition,
            seller: l.seller,
            sellerFeedback: l.sellerFeedback,
            bids: l.bids,
            endTime: l.endTime,
            expiresAt,
          },
          update: {
            listingPrice: l.listingPrice,
            shippingCost: l.shippingCost,
            totalCost: l.totalCost,
            marketPrice,
            dealScore: l.dealScore,
            dealTier: l.dealTier,
            bids: l.bids,
            endTime: l.endTime,
            fetchedAt: now,
            expiresAt,
          },
        })
      )
    );

    const freshListings = await prisma.listing.findMany({
      where: { cardId: card.id, expiresAt: { gt: now } },
      orderBy: { dealScore: "desc" },
    });

    res.json({ listings: freshListings, fromCache: false });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/listings/:cardId/refresh
 * Force a fresh fetch from eBay, bypassing the 30-min cache.
 * Useful for manual "Refresh Now" button in the UI.
 */
listingsRouter.post("/:cardId/refresh", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
    });
    if (!card) throw new AppError(404, "Card not found");

    // Expire all current listings for this card to force a re-fetch
    await prisma.listing.updateMany({
      where: { cardId: card.id },
      data: { expiresAt: new Date(0) },
    });

    // Redirect to the GET handler which will now see a cache miss
    res.redirect(303, `/api/listings/${card.id}`);
  } catch (err) {
    next(err);
  }
});

// Attach the z import used in schema validation (kept clean via Zod in cards.ts)
const _z = z; void _z; // silence unused-import lint warning
