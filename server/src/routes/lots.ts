import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { extractCards, namesToExtracted } from "../services/cardNameExtractor.js";
import { detectLotShape } from "../services/lotDetection.js";
import { scoreLot, valueLot } from "../services/lotValuation.js";
import { searchEbayLots } from "../services/ebay.js";
import { getLotImages } from "../services/lotImages.js";
import {
  dedupeSuggestions,
  runLotVision,
  visionEnabled,
} from "../services/lotVisionAi.js";
import { LISTING_CACHE_TTL_MS } from "../config.js";

export const lotsRouter = Router();
lotsRouter.use(requireAuth);

/**
 * GET /api/lots/search?q=<query>&pageSize=<n>
 *
 * Free-text search for multi-card lot listings.
 *
 * Pipeline:
 *   1. Hit eBay's Browse API with the user's query (`searchEbayLots`).
 *   2. Filter results that don't look "lot-shaped" by title heuristics.
 *   3. Extract card names from each remaining title via the local trie.
 *   4. Value the lot (low/high estimate + tier).
 *   5. Upsert into the `Lot` table with a 30-min TTL.
 *   6. Return the parsed lots ordered by lotScore.
 *
 * Empty parsedCards arrays still get returned (with lotTier=UNSCORED) so
 * the user sees that we found shapes but couldn't identify cards — useful
 * signal that the seller didn't list specifics in the title.
 */
const searchSchema = z.object({
  q: z.string().min(1).max(200),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

lotsRouter.get("/search", async (req, res, next) => {
  try {
    const { q, pageSize } = searchSchema.parse(req.query);
    const result = await searchAndParseLots(q, pageSize);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

interface LotsSearchResult {
  query: string;
  rawEbayCount: number;
  lotShapedCount: number;
  withCardsCount: number;
  /** Parsed lots, sorted by lotScore descending. */
  lots: Array<{
    id: string;
    ebayItemId: string;
    title: string;
    imageUrl: string | null;
    ebayUrl: string;
    listingPrice: number;
    shippingCost: number | null;
    totalCost: number;
    lowEstimate: number;
    highEstimate: number;
    lotScore: number;
    lotTier: string;
    kind: string | null;
    bids: number | null;
    endTime: string | null;
    parsedCards: unknown;
  }>;
}

async function searchAndParseLots(
  query: string,
  pageSize: number
): Promise<LotsSearchResult> {
  const raw = await searchEbayLots(query, pageSize * 3);
  const rawEbayCount = raw.length;

  // Filter to listings that LOOK like lots (cheap title heuristic).
  const lotShaped = raw.filter((l) => detectLotShape(l.title).isLot);

  // Parse + value each surviving listing. We do this serially because each
  // valueLot() does its own DB lookup; parallelising 30 of them is mostly
  // safe but adds connection-pool pressure. Could revisit if this becomes
  // the bottleneck.
  const parsed: Array<{
    raw: typeof lotShaped[number];
    parsedCards: unknown;
    lowEstimate: number;
    highEstimate: number;
    lotScore: number;
    lotTier: string;
    pricedNameCount: number;
  }> = [];

  for (const l of lotShaped) {
    const names = await extractCards(l.title);
    const valuation = await valueLot(names);
    const { lotScore, lotTier } = scoreLot(Number(l.totalCost), valuation.lowEstimate);
    parsed.push({
      raw: l,
      parsedCards: valuation.parsedCards,
      lowEstimate: valuation.lowEstimate,
      highEstimate: valuation.highEstimate,
      lotScore,
      lotTier,
      pricedNameCount: valuation.pricedNameCount,
    });
  }

  console.log(
    `[lots] "${query}" → ${rawEbayCount} raw / ${lotShaped.length} lot-shaped / ` +
      `${parsed.filter((p) => p.pricedNameCount > 0).length} with value range`
  );

  // Persist to Lot table (upsert by ebayItemId, 30-min TTL).
  const expiresAt = new Date(Date.now() + LISTING_CACHE_TTL_MS);
  await prisma.$transaction(
    parsed.map((p) =>
      prisma.lot.upsert({
        where: { ebayItemId: p.raw.ebayItemId },
        create: {
          ebayItemId: p.raw.ebayItemId,
          title: p.raw.title,
          imageUrl: p.raw.imageUrl,
          ebayUrl: p.raw.ebayUrl,
          listingPrice: p.raw.listingPrice,
          shippingCost: p.raw.shippingCost,
          totalCost: p.raw.totalCost,
          lowEstimate: p.lowEstimate,
          highEstimate: p.highEstimate,
          lotScore: p.lotScore,
          lotTier: p.lotTier as Prisma.LotCreateInput["lotTier"],
          kind: p.raw.kind,
          bids: p.raw.bids,
          endTime: p.raw.endTime,
          parsedCards: p.parsedCards as Prisma.InputJsonValue,
          expiresAt,
        },
        update: {
          title: p.raw.title,
          imageUrl: p.raw.imageUrl,
          ebayUrl: p.raw.ebayUrl,
          listingPrice: p.raw.listingPrice,
          shippingCost: p.raw.shippingCost,
          totalCost: p.raw.totalCost,
          lowEstimate: p.lowEstimate,
          highEstimate: p.highEstimate,
          lotScore: p.lotScore,
          lotTier: p.lotTier as Prisma.LotCreateInput["lotTier"],
          kind: p.raw.kind,
          bids: p.raw.bids,
          endTime: p.raw.endTime,
          parsedCards: p.parsedCards as Prisma.InputJsonValue,
          parsedAt: new Date(),
          expiresAt,
        },
      })
    )
  );

  // Read back. Sort scored lots first (any tier except UNSCORED), then by
  // score desc. UNSCORED lots — those where we couldn't identify any priced
  // cards — sink to the bottom because their score is meaningless. Without
  // this, vague "30 Card Lot guaranteed rare" listings dominate the top of
  // the feed and bury actual scored matches.
  const lots = await prisma.lot.findMany({
    where: { ebayItemId: { in: parsed.map((p) => p.raw.ebayItemId) } },
    orderBy: [
      // Prisma can't do conditional sort, so we order by tier first using
      // the raw SQL collation. UNSCORED sorts alphabetically before others,
      // but we want it LAST — handle in JS post-sort below.
      { lotScore: "desc" },
    ],
    take: pageSize * 2, // fetch extra so we have room after the in-JS shuffle
  });

  // Move every UNSCORED to the back of the list, preserving the existing
  // score order within each bucket.
  const scored = lots.filter((l) => l.lotTier !== "UNSCORED");
  const unscored = lots.filter((l) => l.lotTier === "UNSCORED");
  const ordered = [...scored, ...unscored].slice(0, pageSize);

  return {
    query,
    rawEbayCount,
    lotShapedCount: lotShaped.length,
    withCardsCount: parsed.filter((p) => p.pricedNameCount > 0).length,
    lots: ordered.map((l) => ({
      id: l.id,
      ebayItemId: l.ebayItemId,
      title: l.title,
      imageUrl: l.imageUrl,
      ebayUrl: l.ebayUrl,
      listingPrice: Number(l.listingPrice),
      shippingCost: l.shippingCost != null ? Number(l.shippingCost) : null,
      totalCost: Number(l.totalCost),
      lowEstimate: Number(l.lowEstimate),
      highEstimate: Number(l.highEstimate),
      lotScore: l.lotScore,
      lotTier: l.lotTier,
      kind: l.kind,
      bids: l.bids,
      endTime: l.endTime?.toISOString() ?? null,
      parsedCards: l.parsedCards,
    })),
  };
}

// ─── Lot annotation routes (Pb-next: user-assisted analyzer) ─────────────────

/**
 * Shape stored in `LotAnnotation.addedCards`. Kept in sync with the
 * client type in `client/src/types/index.ts` — both should evolve together.
 */
const addedCardSchema = z.object({
  cardId: z.string().min(1).max(50),
  quantity: z.number().int().min(1).max(999).default(1),
  note: z.string().max(200).optional(),
});
const annotationUpsertSchema = z.object({
  addedCards: z.array(addedCardSchema).max(200),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * GET /api/lots/:ebayItemId/annotation
 *
 * Returns the current user's analysis of this lot. 200 with an empty
 * annotation object when nothing's saved yet (UI uses this to seed the
 * modal with a clean editable state).
 */
lotsRouter.get("/:ebayItemId/annotation", async (req, res, next) => {
  try {
    const row = await prisma.lotAnnotation.findUnique({
      where: {
        userId_ebayItemId: {
          userId: req.user!.userId,
          ebayItemId: req.params.ebayItemId,
        },
      },
    });
    if (!row) {
      return res.json({
        ebayItemId: req.params.ebayItemId,
        addedCards: [],
        notes: null,
        createdAt: null,
        updatedAt: null,
      });
    }
    res.json({
      ebayItemId: row.ebayItemId,
      addedCards: row.addedCards,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/lots/:ebayItemId/annotation
 *
 * Replace the user's analysis. Body: { addedCards: [...], notes?: string }.
 * Returns the saved row plus a fresh valuation that *includes* the user's
 * additions, so the UI can render the new total immediately.
 */
lotsRouter.put("/:ebayItemId/annotation", async (req, res, next) => {
  try {
    const { addedCards, notes } = annotationUpsertSchema.parse(req.body);

    // Validate every cardId actually exists. Cheap one-shot query.
    if (addedCards.length > 0) {
      const ids = [...new Set(addedCards.map((c) => c.cardId))];
      const found = await prisma.card.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        const missing = ids.filter((id) => !found.some((f) => f.id === id));
        throw new AppError(400, `Unknown card id(s): ${missing.join(", ")}`);
      }
    }

    const upserted = await prisma.lotAnnotation.upsert({
      where: {
        userId_ebayItemId: {
          userId: req.user!.userId,
          ebayItemId: req.params.ebayItemId,
        },
      },
      create: {
        userId: req.user!.userId,
        ebayItemId: req.params.ebayItemId,
        addedCards: addedCards as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
      update: {
        addedCards: addedCards as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
    });

    // Re-value: combine the lot's auto-parsed cards (from Lot row) with
    // these user additions, return the new estimate range.
    const revaluation = await reValueWithAnnotation(
      req.params.ebayItemId,
      addedCards
    );

    res.json({
      ebayItemId: upserted.ebayItemId,
      addedCards: upserted.addedCards,
      notes: upserted.notes,
      createdAt: upserted.createdAt,
      updatedAt: upserted.updatedAt,
      revaluation,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/lots/:ebayItemId/ocr-suggestions  (Pc — vision-AI suggestions)
 *
 * Identify Pokémon cards visible in the listing's photos and return them
 * as suggestion chips for the analyzer modal.
 *
 * Idempotent — first call hits the Anthropic API (and stores results on
 * `LotImage.ocrText`); subsequent calls replay from cache. POST rather
 * than GET because the first call has side effects (DB write + upstream
 * API spend), and we want clients to opt in explicitly via a button click.
 *
 * Returns 503 when the vision provider is disabled (`OCR_PROVIDER=none`
 * or no `ANTHROPIC_API_KEY`) so the UI can hide the button cleanly.
 */
lotsRouter.post("/:ebayItemId/ocr-suggestions", async (req, res, next) => {
  try {
    if (!visionEnabled()) {
      return res
        .status(503)
        .json({ error: "Vision suggestions are not enabled on this server." });
    }

    // Ensure the lot's images are cached locally (no-op if already fetched).
    // This is the same path the analyzer modal hits for the gallery, so it's
    // already warm in 99% of cases.
    await getLotImages(req.params.ebayItemId);

    const result = await runLotVision(req.params.ebayItemId);
    const merged = dedupeSuggestions(result.suggestions);

    // Resolve each suggested name to catalog Card rows + price candidates
    // via the existing valuation pipeline. This gives the UI the same
    // candidate-printing shape used for auto-parsed cards.
    const extracted = await namesToExtracted(
      merged.map((s) => ({
        name: s.name,
        quantity: s.quantity,
        confidence: s.confidence,
      }))
    );
    const valuation = await valueLot(extracted);

    // Re-attach the per-suggestion source-image position + cardNumber/setHint
    // hints. We do this by aligning the valuation's parsedCards back to the
    // merged suggestions (both are in extracted-input order).
    const suggestions = valuation.parsedCards.map((parsed, i) => ({
      name: parsed.name,
      quantity: parsed.quantity,
      confidence: parsed.confidence,
      candidates: parsed.candidates,
      setHint: merged[i]?.setHint ?? null,
      cardNumber: merged[i]?.cardNumber ?? null,
      sourceImagePosition: merged[i]?.sourceImagePosition ?? null,
    }));

    res.json({
      ebayItemId: req.params.ebayItemId,
      suggestions,
      cacheStatus: result.cacheStatus,
      imagesProcessed: result.imagesProcessed,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/lots/:ebayItemId/images
 *
 * Returns the full eBay image set for a listing. Fetches from eBay on
 * cache miss and persists to LotImage. UI uses this to power the
 * analyzer modal's gallery.
 */
lotsRouter.get("/:ebayItemId/images", async (req, res, next) => {
  try {
    const images = await getLotImages(req.params.ebayItemId);
    res.json({ ebayItemId: req.params.ebayItemId, images });
  } catch (err) {
    next(err);
  }
});

/**
 * Compute a fresh value range that overlays user-added cards onto the
 * lot's existing auto-parsed cards. The Lot row's own `lowEstimate` and
 * `highEstimate` are *not* mutated — those reflect what the auto-extractor
 * believes. The revaluation here is the union and is returned alongside,
 * so the UI can render both numbers ("auto says X, with your additions Y").
 */
async function reValueWithAnnotation(
  ebayItemId: string,
  addedCards: Array<{ cardId: string; quantity: number; note?: string }>
): Promise<{
  autoLowEstimate: number;
  autoHighEstimate: number;
  withAnnotationLowEstimate: number;
  withAnnotationHighEstimate: number;
  addedCardSummaries: Array<{
    cardId: string;
    name: string;
    setName: string;
    number: string;
    market: number | null;
    quantity: number;
    note: string | null;
  }>;
}> {
  const lot = await prisma.lot.findUnique({ where: { ebayItemId } });
  const autoLow = lot ? Number(lot.lowEstimate) : 0;
  const autoHigh = lot ? Number(lot.highEstimate) : 0;

  // Look up each added card and its best market price.
  const addedIds = [...new Set(addedCards.map((c) => c.cardId))];
  const cardRows = addedIds.length === 0
    ? []
    : await prisma.card.findMany({
        where: { id: { in: addedIds } },
        select: {
          id: true,
          name: true,
          number: true,
          setName: true,
          tcgplayerPrices: true,
          cardmarketPrices: true,
        },
      });
  const byId = new Map(cardRows.map((c) => [c.id, c]));

  let addedValue = 0;
  const addedCardSummaries = addedCards.map((entry) => {
    const card = byId.get(entry.cardId);
    if (!card) {
      return {
        cardId: entry.cardId,
        name: "(unknown)",
        setName: "—",
        number: "—",
        market: null,
        quantity: entry.quantity,
        note: entry.note ?? null,
      };
    }
    const market = bestSingleMarket(card.tcgplayerPrices, card.cardmarketPrices);
    if (market != null) addedValue += market * entry.quantity;
    return {
      cardId: card.id,
      name: card.name,
      setName: card.setName,
      number: card.number,
      market,
      quantity: entry.quantity,
      note: entry.note ?? null,
    };
  });

  return {
    autoLowEstimate: autoLow,
    autoHighEstimate: autoHigh,
    // User additions are deterministic (no candidate range — they picked
    // the exact printing), so they contribute equally to low and high.
    withAnnotationLowEstimate: round(autoLow + addedValue),
    withAnnotationHighEstimate: round(autoHigh + addedValue),
    addedCardSummaries,
  };
}

interface TcgVariants {
  [variant: string]: { market?: number | null } | undefined;
}
interface CardmarketShape {
  trendPrice?: number | null;
  averageSellPrice?: number | null;
}

function bestSingleMarket(
  tcgplayer: unknown,
  cardmarket: unknown
): number | null {
  if (tcgplayer && typeof tcgplayer === "object") {
    const prices = Object.values(tcgplayer as TcgVariants)
      .map((v) => v?.market ?? null)
      .filter((m): m is number => m != null && m > 0);
    if (prices.length > 0) return Math.max(...prices);
  }
  if (cardmarket && typeof cardmarket === "object") {
    const cm = cardmarket as CardmarketShape;
    return cm.trendPrice ?? cm.averageSellPrice ?? null;
  }
  return null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
