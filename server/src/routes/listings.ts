import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { searchEbayListings } from "../services/ebay.js";
import { fetchCardById } from "../services/pokemontcg.js";
import { scoreAndSort } from "../services/dealScore.js";
import { evaluateListings, evaluateListingsForWatchedSellers } from "../services/alerts.js";
import {
  resolveMarketPrice,
  variantToEbayKeyword,
} from "../services/priceVariant.js";
import type { CardmarketPrices } from "../services/pokemontcg.js";
import { LISTING_CACHE_TTL_MS, PRICE_CACHE_TTL_MS } from "../config.js";

export const listingsRouter = Router();
listingsRouter.use(requireAuth);

/**
 * GET /api/listings
 * All non-expired listings across every watched card for the authenticated
 * user. Sorted by dealScore desc. The card's PriceCache is embedded so the
 * client can derive the variant-specific market price.
 */
listingsRouter.get("/", async (req, res, next) => {
  try {
    const now = new Date();

    const userCards = await prisma.watchedCard.findMany({
      where: { userId: req.user!.userId },
      select: { id: true },
    });
    const cardIds = userCards.map((c) => c.id);

    const listings = await prisma.listing.findMany({
      where: {
        cardId: { in: cardIds },
        expiresAt: { gt: now },
      },
      include: {
        card: {
          select: {
            id: true,
            pokemonTcgId: true,
            cardName: true,
            setName: true,
            cardNumber: true,
            variant: true,
            groupId: true,
            priceCache: true,
          },
        },
      },
      orderBy: { dealScore: "desc" },
    });

    res.json({ listings });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/listings/:cardId
 * Returns all non-expired eBay listings for a watched card, scored by deal
 * tier. On a cache miss (no listings or all expired), fetches fresh data
 * from eBay and re-scores against the latest TCGPlayer market price for the
 * card's variant.
 */
listingsRouter.get("/:cardId", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
      include: { priceCache: true },
    });
    if (!card) throw new AppError(404, "Card not found");

    const now = new Date();
    const cachedListings = await prisma.listing.findMany({
      where: { cardId: card.id, expiresAt: { gt: now } },
      orderBy: { dealScore: "desc" },
    });

    if (cachedListings.length > 0) {
      return res.json({ listings: cachedListings, fromCache: true });
    }

    // ── Cache miss: fetch fresh prices + listings ────────────────────────────

    let variantsJson: unknown = card.priceCache?.variants ?? null;
    let cardmarketPrices: CardmarketPrices | null =
      (card.priceCache?.cardmarketPrices as CardmarketPrices | null) ?? null;
    const priceExpired =
      !card.priceCache || card.priceCache.expiresAt < now;

    if (priceExpired) {
      const fresh = await fetchCardById(card.pokemonTcgId);
      if (fresh) {
        // Refresh both TCGPlayer and cardmarket caches in lockstep, even for
        // cards where one source is empty — empty data is itself a useful
        // cached fact (avoids re-asking pokemontcg.io repeatedly).
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

    // Four-tier market resolution (tcgplayer → scrape → cardmarket → null).
    const resolved = await resolveMarketPrice({
      pokemonTcgId: card.pokemonTcgId,
      cardName: card.cardName,
      setName: card.setName,
      cardNumber: card.cardNumber,
      variant: card.variant,
      tcgplayerVariants: variantsJson,
      cardmarketPrices,
    });

    // marketPrice = 0 short-circuits scoreAndSort → UNSCORED tier, listings
    // are still surfaced. priceSource/priceCurrency persisted so the UI can
    // render the right chip + currency.
    const marketPrice = resolved?.market ?? 0;
    const priceSource = resolved?.source ?? "none";
    const priceCurrency = resolved?.currency ?? "USD";

    console.log(
      `[priceSource] ${card.pokemonTcgId} (${card.variant}): ${priceSource}` +
        (resolved ? ` ${priceCurrency} ${resolved.market}` : " — UNSCORED")
    );

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
            // Backfill kind on legacy rows where it's null. Static once set.
            kind: l.kind,
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

    // Fire any alerts for this batch. Idempotent via the (cardId, listingId,
    // kind) unique index so repeated refreshes of the same HOT listing don't
    // spam alert rows. Awaited (not fire-and-forget) so we can include the
    // count in the response — useful for the UI to flash "N new alerts".
    let alertsCreated = await evaluateListings(card, freshListings);
    // D2: also evaluate against WatchedSeller rows so the user's manual
    // refresh fires SELLER_LISTING alerts alongside the standard
    // TARGET_HIT / HOT_DEAL kinds.
    alertsCreated += await evaluateListingsForWatchedSellers(
      freshListings.map((l) => ({ id: l.id, seller: l.seller }))
    );

    res.json({
      listings: freshListings,
      fromCache: false,
      alertsCreated,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/listings/:cardId/refresh
 * Force a fresh fetch from eBay, bypassing the 30-min cache.
 */
listingsRouter.post("/:cardId/refresh", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.cardId, userId: req.user!.userId },
    });
    if (!card) throw new AppError(404, "Card not found");

    await prisma.listing.updateMany({
      where: { cardId: card.id },
      data: { expiresAt: new Date(0) },
    });

    res.redirect(303, `/api/listings/${card.id}`);
  } catch (err) {
    next(err);
  }
});
