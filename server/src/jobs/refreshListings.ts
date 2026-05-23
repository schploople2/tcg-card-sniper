import cron from "node-cron";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { searchEbayListings } from "../services/ebay.js";
import { fetchCardById } from "../services/pokemontcg.js";
import { scoreAndSort } from "../services/dealScore.js";
import {
  resolveMarketPrice,
  variantToEbayKeyword,
} from "../services/priceVariant.js";
import type { CardmarketPrices } from "../services/pokemontcg.js";
import { evaluateListings } from "../services/alerts.js";
import { LISTING_CACHE_TTL_MS, PRICE_CACHE_TTL_MS } from "../config.js";

/**
 * Background cron job — refreshes eBay listings for all watched cards
 * every 30 minutes (only for listings that have expired).
 *
 * Schedule: "0,30 * * * *" = at :00 and :30 of every hour.
 *
 * For each stale card:
 *  1. Refresh TCGPlayer prices from pokemontcg.io if the cache is expired.
 *  2. Pull the market price for the card's chosen variant.
 *  3. Fetch + score fresh eBay listings against that market price.
 *  4. Upsert with a new 30-min TTL.
 */
export function startRefreshJob(): void {
  cron.schedule("0,30 * * * *", async () => {
    console.log(`[refreshJob] Starting listing refresh at ${new Date().toISOString()}`);

    try {
      const now = new Date();

      const staleCards = await prisma.watchedCard.findMany({
        where: {
          OR: [
            { listings: { none: {} } },
            { listings: { some: { expiresAt: { lte: now } } } },
          ],
        },
        include: { priceCache: true },
        distinct: ["pokemonTcgId", "variant"],
      });

      console.log(`[refreshJob] ${staleCards.length} cards to refresh`);

      for (const card of staleCards) {
        try {
          // 1. Refresh prices if expired (TCGPlayer + cardmarket together).
          let variantsJson: unknown = card.priceCache?.variants ?? null;
          let cardmarketPrices: CardmarketPrices | null =
            (card.priceCache?.cardmarketPrices as CardmarketPrices | null) ?? null;
          const priceExpired = !card.priceCache || card.priceCache.expiresAt < now;

          if (priceExpired) {
            const fresh = await fetchCardById(card.pokemonTcgId);
            if (fresh) {
              const variants = fresh.variantPrices as unknown as Prisma.InputJsonValue;
              const cm = fresh.cardmarketPrices as unknown as Prisma.InputJsonValue | null;
              variantsJson = variants;
              cardmarketPrices = fresh.cardmarketPrices;
              await prisma.priceCache.upsert({
                where: { cardId: card.id },
                create: {
                  cardId: card.id,
                  variants,
                  cardmarketPrices: cm ?? undefined,
                  expiresAt: new Date(now.getTime() + PRICE_CACHE_TTL_MS),
                },
                update: {
                  variants,
                  cardmarketPrices: cm ?? undefined,
                  fetchedAt: now,
                  expiresAt: new Date(now.getTime() + PRICE_CACHE_TTL_MS),
                },
              });
            }
          }

          // Four-tier resolution. UNSCORED still surfaces listings — the
          // cron job's job is to keep eBay data fresh, not to gate-keep.
          const resolved = await resolveMarketPrice({
            pokemonTcgId: card.pokemonTcgId,
            cardName: card.cardName,
            setName: card.setName,
            cardNumber: card.cardNumber,
            variant: card.variant,
            tcgplayerVariants: variantsJson,
            cardmarketPrices,
          });
          const marketPrice = resolved?.market ?? 0;
          const priceSource = resolved?.source ?? "none";
          const priceCurrency = resolved?.currency ?? "USD";

          // 2. Fetch + score listings
          const ebayKeyword = variantToEbayKeyword(card.variant);
          const rawListings = await searchEbayListings(
            card.cardName,
            card.cardNumber,
            ebayKeyword,
            card.setName
          );
          const scored = scoreAndSort(rawListings, marketPrice);
          const expiresAt = new Date(now.getTime() + LISTING_CACHE_TTL_MS);

          await prisma.$transaction(
            scored.map((l) =>
              prisma.listing.upsert({
                where: { cardId_ebayItemId: { cardId: card.id, ebayItemId: l.ebayItemId } },
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
                  priceSource,
                  priceCurrency,
                  adjustedMarketPrice: l.adjustedMarketPrice,
                  conditionGrade: l.conditionGrade,
                  dealScore: l.dealScore,
                  dealTier: l.dealTier,
                  listingType: l.listingType,
                  kind: l.kind,
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
                  priceSource,
                  priceCurrency,
                  adjustedMarketPrice: l.adjustedMarketPrice,
                  conditionGrade: l.conditionGrade,
                  dealScore: l.dealScore,
                  dealTier: l.dealTier,
                  kind: l.kind,
                  bids: l.bids,
                  endTime: l.endTime,
                  fetchedAt: now,
                  expiresAt,
                },
              })
            )
          );

          // Fan out alerts to every user watching this card+variant. The cron
          // upserts listings against ONE chosen WatchedCard row (via `distinct`
          // above), but every sibling user who watches the same printing
          // deserves an alert when their target hits or the deal scores HOT.
          // Each sibling's Alert references their own WatchedCard.id, so the
          // unique(cardId, listingId, kind) index dedupes per-user, not globally.
          const freshListings = await prisma.listing.findMany({
            where: { cardId: card.id, expiresAt: { gt: now } },
            select: { id: true, totalCost: true, dealTier: true },
          });

          const siblings = await prisma.watchedCard.findMany({
            where: {
              pokemonTcgId: card.pokemonTcgId,
              variant: card.variant,
            },
            select: { id: true, userId: true, targetPrice: true },
          });

          let alertsCreated = 0;
          for (const sib of siblings) {
            alertsCreated += await evaluateListings(sib, freshListings);
          }

          console.log(
            `[refreshJob] ✓ "${card.cardName}" — ${scored.length} listings, ` +
              `best score: ${scored[0]?.dealScore ?? "n/a"}%, ` +
              `${alertsCreated} alerts across ${siblings.length} watchers`
          );
        } catch (cardErr) {
          console.error(`[refreshJob] ✗ Failed for "${card.cardName}":`, cardErr);
        }
      }

      console.log(`[refreshJob] Done at ${new Date().toISOString()}`);
    } catch (err) {
      console.error("[refreshJob] Job failed:", err);
    }
  });
}
