import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  getMarketForVariant,
  getCardmarketForVariant,
} from "../services/priceVariant.js";

export const portfolioRouter = Router();
portfolioRouter.use(requireAuth);

// ─── Validation schemas ───────────────────────────────────────────────────────

const KIND = ["raw", "graded", "sealed"] as const;

const createItemSchema = z
  .object({
    cardId: z.string().min(1).optional(),
    /** Display name for sealed product with no single-card catalog row. */
    label: z.string().min(1).max(200).optional(),
    variant: z.string().min(1).optional(),
    kind: z.enum(KIND).default("raw"),
    gradingCompany: z.string().min(1).max(50).optional(),
    grade: z.string().min(1).max(20).optional(),
    quantity: z.coerce.number().int().min(1).max(9999).default(1),
    acquisitionPrice: z.coerce.number().nonnegative(),
    acquiredAt: z.coerce.date().optional(),
    notes: z.string().max(2000).optional(),
  })
  .refine((d) => d.kind === "sealed" || !!d.cardId, {
    message: "cardId is required for raw and graded items",
    path: ["cardId"],
  })
  .refine((d) => d.kind === "sealed" || !!d.variant, {
    message: "variant is required for raw and graded items",
    path: ["variant"],
  })
  .refine((d) => !!d.cardId || !!d.label, {
    message: "label is required when cardId is omitted",
    path: ["label"],
  })
  .refine((d) => d.kind !== "graded" || (!!d.gradingCompany && !!d.grade), {
    message: "gradingCompany and grade are required for graded items",
    path: ["grade"],
  });

const updateItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(9999).optional(),
  acquisitionPrice: z.coerce.number().nonnegative().optional(),
  acquiredAt: z.coerce.date().optional(),
  notes: z.string().max(2000).nullable().optional(),
  gradingCompany: z.string().min(1).max(50).nullable().optional(),
  grade: z.string().min(1).max(20).nullable().optional(),
});

// ─── Pricing annotation ────────────────────────────────────────────────────────

export type PortfolioCard = {
  id: string;
  name: string;
  number: string;
  setName: string;
  imageSmall: string | null;
  tcgplayerPrices: unknown;
  cardmarketPrices: unknown;
} | null;

export type PortfolioItemRow = {
  id: string;
  cardId: string | null;
  label: string | null;
  variant: string | null;
  kind: string;
  gradingCompany: string | null;
  grade: string | null;
  quantity: number;
  acquisitionPrice: number;
  acquiredAt: Date;
  notes: string | null;
  card: PortfolioCard;
};

/**
 * Resolve a per-unit current market price for a portfolio item without
 * hitting the network. Only the cached tiers of the price waterfall
 * (tcgplayer cache, cardmarket) are used — the live TCGPlayer scrape
 * fallback in resolveMarketPrice is skipped here since this runs on every
 * list-page render, not a single-card lookup.
 */
function currentMarketFor(item: PortfolioItemRow): {
  market: number;
  currency: string;
} | null {
  if (!item.card || !item.variant) return null;
  const tcg = getMarketForVariant(item.card.tcgplayerPrices, item.variant);
  if (tcg != null && tcg > 0) return { market: tcg, currency: "USD" };
  const cm = getCardmarketForVariant(
    item.card.cardmarketPrices as never,
    item.variant
  );
  if (cm != null && cm > 0) return { market: cm, currency: "EUR" };
  return null;
}

/**
 * Pure annotation step — attaches per-unit + total current value and
 * unrealized P&L to a raw item row. Extracted for unit-test coverage
 * without spinning up Prisma.
 */
export function annotatePortfolioItem(item: PortfolioItemRow) {
  const priced = currentMarketFor(item);
  const displayName = item.card?.name ?? item.label ?? "Unknown item";
  const totalCost = item.acquisitionPrice * item.quantity;
  const currentValue = priced ? priced.market * item.quantity : null;
  const unrealizedPnl = currentValue != null ? currentValue - totalCost : null;

  return {
    id: item.id,
    cardId: item.cardId,
    label: displayName,
    setName: item.card?.setName ?? null,
    number: item.card?.number ?? null,
    imageSmall: item.card?.imageSmall ?? null,
    variant: item.variant,
    kind: item.kind,
    gradingCompany: item.gradingCompany,
    grade: item.grade,
    quantity: item.quantity,
    acquisitionPrice: item.acquisitionPrice,
    acquiredAt: item.acquiredAt,
    notes: item.notes,
    totalCost,
    currentMarket: priced?.market ?? null,
    currentValue,
    unrealizedPnl,
    priceCurrency: priced?.currency ?? null,
    priceSource: priced ? (priced.currency === "USD" ? "tcgplayer" : "cardmarket") : "none",
  };
}

const CARD_SELECT = {
  id: true,
  name: true,
  number: true,
  setName: true,
  imageSmall: true,
  tcgplayerPrices: true,
  cardmarketPrices: true,
} as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/portfolio — list the user's collection items with computed
 * current-market value and unrealized P&L, plus a rollup summary.
 */
portfolioRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.collectionItem.findMany({
      where: { userId: req.user!.userId },
      include: { card: { select: CARD_SELECT } },
      orderBy: { acquiredAt: "desc" },
    });

    const items = rows.map((row) =>
      annotatePortfolioItem({
        ...row,
        acquisitionPrice: Number(row.acquisitionPrice),
      })
    );

    // totalPnl is computed only over priced items — unpriced items (no
    // tcgplayer/cardmarket data cached on the card yet) would otherwise
    // count their full cost against zero value and understate P&L.
    // pricedCost/totalCost being unequal is the client's signal to show
    // "N unpriced" instead of treating totalPnl as covering everyone.
    let totalCost = 0;
    let pricedCost = 0;
    let totalValue = 0;
    let pricedCount = 0;
    for (const item of items) {
      totalCost += item.totalCost;
      if (item.currentValue != null) {
        pricedCost += item.totalCost;
        totalValue += item.currentValue;
        pricedCount += 1;
      }
    }

    res.json({
      items,
      summary: {
        count: items.length,
        pricedCount,
        totalCost,
        totalValue,
        totalPnl: totalValue - pricedCost,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/portfolio — add an item to the collection.
 *
 * cardId (when present) must reference a card already in the local catalog
 * — the same Card table /api/catalog/search reads from — since pricing
 * needs the cached tcgplayer/cardmarket prices on that row.
 */
portfolioRouter.post("/", async (req, res, next) => {
  try {
    const data = createItemSchema.parse(req.body);

    if (data.cardId) {
      const card = await prisma.card.findUnique({ where: { id: data.cardId } });
      if (!card) {
        throw new AppError(404, `Card "${data.cardId}" not found in catalog`);
      }
      if (data.variant && card.variants.length > 0 && !card.variants.includes(data.variant)) {
        throw new AppError(
          400,
          `Variant "${data.variant}" not available for this card. Available: ${card.variants.join(", ")}`
        );
      }
    }

    const item = await prisma.collectionItem.create({
      data: {
        userId: req.user!.userId,
        cardId: data.cardId ?? null,
        label: data.label ?? null,
        variant: data.variant ?? null,
        kind: data.kind,
        gradingCompany: data.gradingCompany ?? null,
        grade: data.grade ?? null,
        quantity: data.quantity,
        acquisitionPrice: data.acquisitionPrice,
        acquiredAt: data.acquiredAt ?? new Date(),
        notes: data.notes ?? null,
      },
      include: { card: { select: CARD_SELECT } },
    });

    res.status(201).json(
      annotatePortfolioItem({
        ...item,
        acquisitionPrice: Number(item.acquisitionPrice),
      })
    );
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/portfolio/:id — update quantity, cost basis, dates, or notes. */
portfolioRouter.patch("/:id", async (req, res, next) => {
  try {
    const updates = updateItemSchema.parse(req.body);

    const existing = await prisma.collectionItem.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!existing) throw new AppError(404, "Collection item not found");

    const item = await prisma.collectionItem.update({
      where: { id: req.params.id },
      data: updates,
      include: { card: { select: CARD_SELECT } },
    });

    res.json(
      annotatePortfolioItem({
        ...item,
        acquisitionPrice: Number(item.acquisitionPrice),
      })
    );
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/portfolio/:id — remove an item from the collection. */
portfolioRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.collectionItem.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!existing) throw new AppError(404, "Collection item not found");

    await prisma.collectionItem.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
