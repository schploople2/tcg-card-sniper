import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { fetchCardById } from "../services/pokemontcg.js";
import { PRICE_CACHE_TTL_MS } from "../config.js";
import { getSoldComps, summariseSoldComps } from "../services/soldComps.js";
import { variantToEbayKeyword } from "../services/priceVariant.js";

export const cardsRouter = Router();
cardsRouter.use(requireAuth);

// ─── Validation schemas ───────────────────────────────────────────────────────

const createCardSchema = z.object({
  pokemonTcgId: z.string().min(1, "pokemonTcgId is required"),
  /** Variant key from TCGPlayer prices (e.g. "normal", "holofoil") */
  variant: z.string().min(1),
  /** Filled by the client from the catalog selection (server re-validates by fetching the card) */
  cardName: z.string().min(1).max(200).optional(),
  setName: z.string().min(1).max(200).optional(),
  cardNumber: z.string().max(20).optional(),
});

const updateCardSchema = z.object({
  variant: z.string().min(1).optional(),
  /**
   * Target price in USD. Set to null/0 to clear. Accepts numeric strings
   * from the inline editor without forcing the client to parse first.
   * Stored as Decimal(10,2); zero is normalised to null so "0" means "no target."
   */
  targetPrice: z
    .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,2})?$/), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return v;
      const n = typeof v === "string" ? parseFloat(v) : v;
      return n === 0 ? null : n;
    }),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /api/cards — list all watched cards for the authenticated user */
cardsRouter.get("/", async (req, res, next) => {
  try {
    const cards = await prisma.watchedCard.findMany({
      where: { userId: req.user!.userId },
      include: {
        priceCache: true,
        listings: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { dealScore: "desc" },
          take: 1, // include best current listing per card
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(cards);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/cards — add a card to the watchlist.
 *
 * The client picks a card from the catalog (pokemontcg.io) and sends back the
 * pokemonTcgId + chosen variant. We re-fetch the card server-side so cardName,
 * setName, cardNumber, and the variant prices are authoritative (the client
 * payload is treated as a hint, not the source of truth).
 *
 * A pokemontcg.io failure rejects the create — without an authoritative
 * catalog entry, the card has no useful identity.
 */
cardsRouter.post("/", async (req, res, next) => {
  try {
    const data = createCardSchema.parse(req.body);

    const catalogCard = await fetchCardById(data.pokemonTcgId);
    if (!catalogCard) {
      throw new AppError(404, `Card "${data.pokemonTcgId}" not found in pokemontcg.io catalog`);
    }

    // Validate the chosen variant exists on this card (or accept "normal" as
    // a fallback when the card has no TCGPlayer data — we still let users
    // track new releases without prices)
    const variantExists =
      catalogCard.variants.includes(data.variant) ||
      catalogCard.variants.length === 0;
    if (!variantExists) {
      throw new AppError(
        400,
        `Variant "${data.variant}" not available for this card. ` +
          `Available: ${catalogCard.variants.join(", ") || "(none)"}`
      );
    }

    const now = new Date();
    const card = await prisma.watchedCard.create({
      data: {
        userId: req.user!.userId,
        pokemonTcgId: catalogCard.id,
        cardName: catalogCard.name,
        setName: catalogCard.setName,
        cardNumber: catalogCard.number,
        variant: data.variant,
      },
    });

    // Eagerly cache whatever prices pokemontcg.io returned — TCGPlayer
    // variants, cardmarket aggregates, or both. We persist even when
    // tcgplayer is empty (alt-arts like sm11-79a Jirachi-GX) so the
    // resolver downstream has the cardmarket fallback to draw from.
    let priceCache = null;
    const hasAnyPrice =
      catalogCard.variants.length > 0 || catalogCard.cardmarketPrices !== null;
    if (hasAnyPrice) {
      const variants = catalogCard.variantPrices as unknown as Prisma.InputJsonValue;
      const cm = catalogCard.cardmarketPrices as unknown as Prisma.InputJsonValue | null;
      priceCache = await prisma.priceCache.upsert({
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

    res.status(201).json({ ...card, priceCache });
  } catch (err) {
    next(err);
  }
});

/** GET /api/cards/:id — get a single card with all current listings */
cardsRouter.get("/:id", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      include: {
        priceCache: true,
        listings: {
          where: { expiresAt: { gt: new Date() } },
          orderBy: { dealScore: "desc" },
        },
      },
    });
    if (!card) throw new AppError(404, "Card not found");
    res.json(card);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cards/:id/sold-comps  (C1)
 *
 * Returns up to 90 days of sold-listing comps for a watched card. The
 * eBay sold-listings page is the underlying data source; results are
 * cached in the SoldComp table for 24h per query to keep traffic light.
 *
 * Response includes both the raw rows and a summary {count, median,
 * low, high, mostRecentAt} so the UI can render a headline without
 * client-side aggregation.
 */
cardsRouter.get("/:id/sold-comps", async (req, res, next) => {
  try {
    const card = await prisma.watchedCard.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!card) throw new AppError(404, "Card not found");

    // Mirror the keyword shape we use for active-listings eBay search so
    // sold comps and active listings are like-for-like.
    const variantKw = variantToEbayKeyword(card.variant);
    const query = [
      card.cardName,
      card.cardNumber,
      variantKw && variantKw.trim(),
    ]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join(" ")
      .trim();

    const { rows, fromCache } = await getSoldComps(query, { cardId: card.id });
    const summary = summariseSoldComps(rows);
    res.json({ query, summary, rows, fromCache });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/cards/:id — update variant and/or targetPrice */
cardsRouter.patch("/:id", async (req, res, next) => {
  try {
    const updates = updateCardSchema.parse(req.body);

    const existing = await prisma.watchedCard.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!existing) throw new AppError(404, "Card not found");

    const card = await prisma.watchedCard.update({
      where: { id: req.params.id },
      data: updates,
    });
    res.json(card);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/cards/:id — remove a card from the watchlist */
cardsRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.watchedCard.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!existing) throw new AppError(404, "Card not found");

    await prisma.watchedCard.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
