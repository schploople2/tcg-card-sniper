import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { extractCards, namesToExtracted } from "../services/cardNameExtractor.js";
import { detectLotShape } from "../services/lotDetection.js";
import {
  scoreLot,
  valueLot,
  mergeTitleAndVisionParsed,
  reValueWithAnnotation,
} from "../services/lotValuation.js";
import { evaluateLotAfterOcr, evaluateLotForMistitling } from "../services/lotAlerts.js";
import { searchEbayLots } from "../services/ebay.js";
import { getLotImages } from "../services/lotImages.js";
import {
  dedupeSuggestions,
  readCachedLotVision,
  runLotVision,
  visionEnabled,
} from "../services/lotVisionAi.js";
import {
  getTodayUsage,
  isUserCapped,
  listTodayUsage,
} from "../services/ocrUsage.js";
import { valueBulk } from "../services/bulkValuation.js";
import { LISTING_CACHE_TTL_MS, config } from "../config.js";

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
  // Accept null (the client's resting state when no note has been typed) as
  // well as a string or omission — the LotAnnotation table stores notes as
  // nullable JSON so all three shapes are equivalent on disk.
  note: z.string().max(200).nullable().optional(),
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
 * POST /api/lots/:ebayItemId/valuation
 *
 * Non-mutating preview: run `reValueWithAnnotation` against the supplied
 * addedCards and return the live valuation without writing anything to
 * LotAnnotation. Powers the live "Lot price vs market" comparison panel
 * in the analyzer modal so the user sees their total update as they add
 * cards.
 */
lotsRouter.post("/:ebayItemId/valuation", async (req, res, next) => {
  try {
    const { addedCards } = z
      .object({ addedCards: z.array(addedCardSchema).max(200) })
      .parse(req.body);
    const revaluation = await reValueWithAnnotation(
      req.params.ebayItemId,
      addedCards
    );
    res.json({ revaluation });
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
 * GET /api/lots/_admin/ocr-usage
 *
 * Today's OCR spend per user, ordered by images processed. Gated behind
 * router-level JWT auth only (anyone logged in can read). Add a real admin
 * role check here when one exists.
 *
 * The `imagesProcessed` totals approximate spend at ~$0.003/image — a row
 * showing 100 images = ~$0.30 today for that user.
 */
lotsRouter.get("/_admin/ocr-usage", async (_req, res, next) => {
  try {
    const rows = await listTodayUsage();
    res.json({
      day: new Date().toISOString().slice(0, 10),
      cap: config.OCR_DAILY_IMAGES_PER_USER,
      users: rows,
      totals: {
        imagesProcessed: rows.reduce((n, r) => n + r.imagesProcessed, 0),
        callsMade: rows.reduce((n, r) => n + r.callsMade, 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/lots/:ebayItemId/ocr-suggestions
 *
 * Cached-only fetch — never calls Anthropic. Used by LotAnalyzerModal on
 * open to rehydrate the AI suggestions + bulk valuation if the lot has
 * been analyzed before. Returns 204 when nothing is cached so the client
 * can fall back to the "Suggest cards from photos" button.
 *
 * Same response shape as POST when there IS cached data, minus
 * imagesProcessed/imagesFailed/providerStatus (which only describe a
 * fresh run).
 */
lotsRouter.get("/:ebayItemId/ocr-suggestions", async (req, res, next) => {
  try {
    const cached = await readCachedLotVision(req.params.ebayItemId);
    if (!cached) return res.status(204).end();

    const merged = dedupeSuggestions(cached.suggestions);
    const extracted = await namesToExtracted(
      merged.map((s) => ({
        name: s.name,
        quantity: s.quantity,
        confidence: s.confidence,
        setHint: s.setHint,
        cardNumber: s.cardNumber,
      }))
    );
    const valuation = await valueLot(extracted);
    const mergedByName = new Map(merged.map((m) => [m.name.toLowerCase(), m]));
    const suggestions = valuation.parsedCards.map((parsed) => {
      const m = mergedByName.get(parsed.name.toLowerCase());
      return {
        name: parsed.name,
        quantity: parsed.quantity,
        confidence: parsed.confidence,
        candidates: parsed.candidates,
        setHint: m?.setHint ?? null,
        cardNumber: m?.cardNumber ?? null,
        sourceImagePosition: m?.sourceImagePosition ?? null,
      };
    });

    const bulkValuation = valueBulk(cached.bulk);
    res.json({
      ebayItemId: req.params.ebayItemId,
      suggestions,
      cacheStatus: "cached" as const,
      bulkCounts: cached.bulk,
      bulkValuation,
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

    // ?force=true → wipe this lot's OCR cache before running so legacy
    // entries (written before the A3 bulk feature shipped) get re-OCR'd
    // and re-populated with bulk-rarity counts. Costs Anthropic credits
    // per image, so the client only fires it when the user explicitly
    // clicks "Refresh AI analysis".
    if (req.query.force === "true") {
      await prisma.lotImage.updateMany({
        where: { ebayItemId: req.params.ebayItemId },
        data: { ocrText: null },
      });
    }

    // Soft daily cap on fresh-API spend per user. Cache hits stay free, so a
    // capped user can still replay any lot they've already analysed today —
    // but the upstream check is conservative (we don't know yet which images
    // are cached) and so a capped user is bounced before we even fetch.
    const userId = req.user!.userId;
    if (await isUserCapped(userId)) {
      const usage = await getTodayUsage(userId);
      return res.status(429).json({
        error:
          `Daily OCR limit reached (${usage.imagesProcessed}/${usage.cap} images). ` +
          `Resets at UTC midnight.`,
        usage,
      });
    }

    // Ensure the lot's images are cached locally (no-op if already fetched).
    // This is the same path the analyzer modal hits for the gallery, so it's
    // already warm in 99% of cases.
    await getLotImages(req.params.ebayItemId);

    const result = await runLotVision(req.params.ebayItemId, { userId });

    // If every attempted vision call threw (credit exhausted, rate limit,
    // upstream 5xx), surface that as 503 so the UI can render "AI
    // temporarily unavailable" instead of the indistinguishable
    // "no cards identified". Partial failures still return 200 with
    // whatever we got plus a warning the UI can display.
    if (result.providerStatus === "all-failed") {
      return res.status(503).json({
        error:
          "AI vision is temporarily unavailable. Please try again later.",
        providerStatus: result.providerStatus,
        imagesFailed: result.imagesFailed,
      });
    }
    const merged = dedupeSuggestions(result.suggestions);

    // Resolve each suggested name to catalog Card rows + price candidates
    // via the existing valuation pipeline. This gives the UI the same
    // candidate-printing shape used for auto-parsed cards.
    //
    // Set + number hints flow through so valuation can narrow the candidate
    // list to the exact printing the model identified — when those hints
    // are present and match. Soft fallback in valueLot recovers candidates
    // if the hint is slightly off.
    const extracted = await namesToExtracted(
      merged.map((s) => ({
        name: s.name,
        quantity: s.quantity,
        confidence: s.confidence,
        setHint: s.setHint,
        cardNumber: s.cardNumber,
      }))
    );
    const valuation = await valueLot(extracted);

    // Re-attach the per-suggestion source-image position + cardNumber/setHint
    // hints for the UI chips. We align by lowercased name rather than by
    // index because `namesToExtracted` skips inputs that don't resolve in
    // the catalog (too-short names or unknown names), so parsedCards may be
    // shorter than `merged` and their indices won't line up.
    const mergedByName = new Map(merged.map((m) => [m.name.toLowerCase(), m]));
    const suggestions = valuation.parsedCards.map((parsed) => {
      const m = mergedByName.get(parsed.name.toLowerCase());
      return {
        name: parsed.name,
        quantity: parsed.quantity,
        confidence: parsed.confidence,
        candidates: parsed.candidates,
        setHint: m?.setHint ?? null,
        cardNumber: m?.cardNumber ?? null,
        sourceImagePosition: m?.sourceImagePosition ?? null,
      };
    });

    // Persist vision findings back to the Lot row so the search feed
    // reflects what's actually in the photos, not just what was in the title.
    // A lot whose title was "100 Card Lot" and was UNSCORED can move to a
    // real tier once vision identifies cards. LotAnnotation (per-user
    // overlay) stays untouched — this only refreshes the public auto-parsed
    // view of the lot.
    const lotUpdate = await persistOcrToLot(req.params.ebayItemId, merged);

    // A1 — fire LOT_HOT alerts (in-app + Discord) when the refreshed
    // valuation crosses the threshold. Fire-and-forget so user-facing
    // OCR responses aren't blocked on user/listing lookups.
    void evaluateLotAfterOcr(req.params.ebayItemId).catch((err) =>
      console.error(
        "[lots] evaluateLotAfterOcr failed:",
        err instanceof Error ? err.message : err
      )
    );
    // A2 — independently fire MISTITLED alerts for hidden-card-in-bulk-lot
    // signal. A lot can fire both LOT_HOT and MISTITLED; they're distinct
    // signals with distinct embeds.
    void evaluateLotForMistitling(req.params.ebayItemId).catch((err) =>
      console.error(
        "[lots] evaluateLotForMistitling failed:",
        err instanceof Error ? err.message : err
      )
    );

    // Surface post-call usage so the modal can render "N of M images today".
    const usage = await getTodayUsage(userId);

    // A3 — value the unidentified bulk cards the model bucketed by rarity.
    // valueBulk returns zeros when totalCards is 0, so the client can hide
    // the bulk row entirely in the common "no bulk visible" case.
    const bulkValuation = valueBulk(result.bulk);

    res.json({
      ebayItemId: req.params.ebayItemId,
      suggestions,
      cacheStatus: result.cacheStatus,
      imagesProcessed: result.imagesProcessed,
      imagesFailed: result.imagesFailed,
      providerStatus: result.providerStatus,
      bulkCounts: result.bulk,
      bulkValuation,
      lotUpdate,
      usage,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Merge vision-derived suggestions into the Lot row's `parsedCards` and
 * re-run valuation + scoring. Returns the before/after summary the UI can
 * use to flash "tier upgraded" / "value range refined" feedback.
 *
 * Merge rule: union by lowercased name. When the same name appears in both
 * the title-extracted set and the vision-derived set, the vision reading
 * wins on quantity / confidence (and contributes the hints). The title
 * already determined that the card was *mentioned*; vision is more
 * informative about how many and which printing.
 *
 * Returns null when the lot row is missing — vision still produced
 * suggestions for the UI, but there's nothing to update.
 */
async function persistOcrToLot(
  ebayItemId: string,
  visionSuggestions: Array<{
    name: string;
    quantity: number;
    confidence: number;
    setHint?: string | null;
    cardNumber?: string | null;
  }>
): Promise<{
  before: { lotTier: string; lotScore: number; lowEstimate: number; highEstimate: number };
  after: { lotTier: string; lotScore: number; lowEstimate: number; highEstimate: number };
} | null> {
  const lot = await prisma.lot.findUnique({ where: { ebayItemId } });
  if (!lot) return null;

  const merged = await namesToExtracted(
    mergeTitleAndVisionParsed(lot.parsedCards, visionSuggestions)
  );
  const valuation = await valueLot(merged);
  const { lotScore, lotTier } = scoreLot(Number(lot.totalCost), valuation.lowEstimate);

  await prisma.lot.update({
    where: { ebayItemId },
    data: {
      parsedCards: valuation.parsedCards as unknown as Prisma.InputJsonValue,
      lowEstimate: valuation.lowEstimate,
      highEstimate: valuation.highEstimate,
      lotScore,
      lotTier: lotTier as Prisma.LotCreateInput["lotTier"],
      parsedAt: new Date(),
    },
  });

  return {
    before: {
      lotTier: lot.lotTier,
      lotScore: lot.lotScore,
      lowEstimate: Number(lot.lowEstimate),
      highEstimate: Number(lot.highEstimate),
    },
    after: {
      lotTier,
      lotScore,
      lowEstimate: valuation.lowEstimate,
      highEstimate: valuation.highEstimate,
    },
  };
}

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

