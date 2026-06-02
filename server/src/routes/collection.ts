import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const collectionRouter = Router();
collectionRouter.use(requireAuth);

// Two Pokémon TCG sets each contain a "Radiant Collection" subset numbered
// RC<n>. Generations (g1) RC1–RC32 and Legendary Treasures (bw11) RC1–RC25.
// Listed in display order: newer (Generations) first, since most users come
// here for that 32-card set.
export const RADIANT_SETS = [
  { setId: "g1", setName: "Generations", total: 32 },
  { setId: "bw11", setName: "Legendary Treasures", total: 25 },
] as const;

export const radiantSetIds = RADIANT_SETS.map((s) => s.setId);

/** RC12 → 12. Used to natural-sort cards within a set. */
export function rcNumber(number: string): number {
  const m = /^RC(\d+)$/.exec(number);
  return m ? Number.parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

export type RadiantCardRow = {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  setId: string;
  setName: string;
  imageSmall: string | null;
  imageLarge: string | null;
  /** TCGPlayer variant keys present on this card. Empty when no TCGPlayer
   *  pricing exists. Used by the client to default a variant when the user
   *  adds the card to their watchlist from the collection page. */
  variants: string[];
};

/**
 * Pure grouping/sorting/annotation step extracted for testability — keeps
 * the route handler thin and the natural-sort + collected-set logic unit
 * coverable without spinning up Prisma.
 */
export function groupRadiantCards(
  cards: RadiantCardRow[],
  collectedCardIds: Iterable<string>,
) {
  const collectedSet = new Set(collectedCardIds);

  const sets = RADIANT_SETS.map((set) => {
    const setCards = cards
      .filter((c) => c.setId === set.setId)
      .sort((a, b) => rcNumber(a.number) - rcNumber(b.number))
      .map((c) => ({ ...c, collected: collectedSet.has(c.id) }));

    return {
      setId: set.setId,
      setName: set.setName,
      total: set.total,
      collected: setCards.filter((c) => c.collected).length,
      cards: setCards,
    };
  });

  const total = sets.reduce((sum, s) => sum + s.total, 0);
  const collected = sets.reduce((sum, s) => sum + s.collected, 0);

  return { total, collected, sets };
}

/**
 * GET /api/collection/radiant
 *
 * Returns the Radiant Collection cards from g1 + bw11 (57 total) grouped by
 * set, each annotated with whether the requesting user has collected it.
 * Absence of a CollectionEntry row = not collected.
 */
collectionRouter.get("/radiant", async (req, res, next) => {
  try {
    const userId = req.user!.userId;

    const [cards, entries] = await Promise.all([
      prisma.card.findMany({
        where: {
          setId: { in: radiantSetIds },
          number: { startsWith: "RC" },
        },
        select: {
          id: true,
          name: true,
          number: true,
          rarity: true,
          setId: true,
          setName: true,
          imageSmall: true,
          imageLarge: true,
          variants: true,
        },
      }),
      prisma.collectionEntry.findMany({
        where: { userId, card: { setId: { in: radiantSetIds } } },
        select: { cardId: true },
      }),
    ]);

    res.json(groupRadiantCards(cards, entries.map((e) => e.cardId)));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/collection/:cardId/toggle
 *
 * Flip the user's collected bit for a single card. Returns the new state.
 * Idempotent in the sense that two toggles return the user to where they
 * started; not idempotent per call (that's the point).
 *
 * 404 if the cardId isn't in the catalog at all. We don't restrict to
 * Radiant cards here — the schema is generic, so other "set tracker" pages
 * can reuse this endpoint later.
 */
collectionRouter.post("/:cardId/toggle", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { cardId } = req.params;

    const card = await prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) {
      return next(new AppError(404, "Card not found"));
    }

    const existing = await prisma.collectionEntry.findUnique({
      where: { userId_cardId: { userId, cardId } },
      select: { id: true },
    });

    if (existing) {
      await prisma.collectionEntry.delete({ where: { id: existing.id } });
      return res.json({ cardId, collected: false });
    }

    await prisma.collectionEntry.create({ data: { userId, cardId } });
    res.json({ cardId, collected: true });
  } catch (err) {
    next(err);
  }
});
