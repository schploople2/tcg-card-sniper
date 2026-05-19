import cron from "node-cron";
import { prisma } from "../db.js";
import { searchEbayListings } from "../services/ebay.js";
import { fetchCardPrices } from "../services/pricecharting.js";
import { scoreAndSort } from "../services/dealScore.js";
import { LISTING_CACHE_TTL_MS, PRICE_CACHE_TTL_MS } from "../config.js";

/**
 * Background cron job — refreshes eBay listings for all watched cards
 * every 30 minutes (only for listings that have expired).
 *
 * Schedule: "0,30 * * * *" = at :00 and :30 of every hour
 *
 * Strategy:
 *  1. Find all unique watched cards across all users
 *  2. For each card, skip if listings are still fresh
 *  3. Re-fetch from eBay + re-score against latest market price
 *  4. Upsert into DB with a new 30-min TTL
 */
export function startRefreshJob(): void {
  cron.schedule("0,30 * * * *", async () => {
    console.log(`[refreshJob] Starting listing refresh at ${new Date().toISOString()}`);

    try {
      const now = new Date();

      // Get all watched cards that have at least one expired (or no) listing
      const staleCards = await prisma.watchedCard.findMany({
        where: {
          OR: [
            { listings: { none: {} } },
            { listings: { some: { expiresAt: { lte: now } } } },
          ],
        },
        include: { priceCache: true },
        distinct: ["cardName", "condition"], // avoid duplicate fetches
      });

      console.log(`[refreshJob] ${staleCards.length} cards to refresh`);

      for (const card of staleCards) {
        try {
          // ── 1. Refresh market price if cache is stale ────────────────────
          let marketPrice: number | null = null;
          const priceExpired = !card.priceCache || card.priceCache.expiresAt < now;

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

          if (!marketPrice) {
            console.warn(`[refreshJob] No market price for "${card.cardName}" — skipping`);
            continue;
          }

          // ── 2. Fetch + score fresh listings ──────────────────────────────
          const rawListings = await searchEbayListings(card.cardName, card.condition);
          const scored = scoreAndSort(rawListings, marketPrice);
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

          console.log(
            `[refreshJob] ✓ "${card.cardName}" — ${scored.length} listings, ` +
            `best score: ${scored[0]?.dealScore ?? "n/a"}%`
          );
        } catch (cardErr) {
          // Log but don't crash the whole job for one card failure
          console.error(`[refreshJob] ✗ Failed for "${card.cardName}":`, cardErr);
        }
      }

      console.log(`[refreshJob] Done at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[refreshJob] Job failed:", err);
    }
  });
}
