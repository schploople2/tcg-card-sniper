import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const cardsRouter = Router();

// All watchlist routes require authentication
cardsRouter.use(requireAuth);

// ─── Validation schemas ───────────────────────────────────────────────────────

const createCardSchema = z.object({
  cardName: z.string().min(1).max(200),
  setName: z.string().min(1).max(200),
  cardNumber: z.string().max(20).optional(),
  condition: z.string().default("Raw NM"),
  /** Maximum total cost the user is willing to pay (listing + shipping) */
  targetPrice: z.number().positive("Target price must be positive"),
});

const updateCardSchema = createCardSchema.partial();

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

/** POST /api/cards — add a card to the watchlist */
cardsRouter.post("/", async (req, res, next) => {
  try {
    const data = createCardSchema.parse(req.body);
    const card = await prisma.watchedCard.create({
      data: { ...data, userId: req.user!.userId },
    });
    res.status(201).json(card);
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

/** PATCH /api/cards/:id — update a watched card (e.g. change target price) */
cardsRouter.patch("/:id", async (req, res, next) => {
  try {
    const updates = updateCardSchema.parse(req.body);

    // Verify ownership
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
