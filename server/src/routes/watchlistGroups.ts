import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const watchlistGroupsRouter = Router();
watchlistGroupsRouter.use(requireAuth);

/**
 * 4ke — User-defined groups for the Watchlist page. One group per
 * WatchedCard (via WatchedCard.groupId, nullable). Deleting a group sets
 * the cards' groupId to null ("Ungrouped") rather than cascading deletes
 * — guaranteed by the schema's `onDelete: SetNull` on the relation, so
 * the DELETE handler doesn't need to manually move cards.
 */

const createSchema = z.object({
  name: z.string().min(1).max(60).trim(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(60).trim().optional(),
    sortOrder: z.number().int().min(0).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.sortOrder !== undefined,
    { message: "Provide at least one of: name, sortOrder" },
  );

function uniqueNameViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

/**
 * GET /api/watchlist-groups — list the user's groups in render order,
 * each annotated with `cardCount` so the client can show "(N cards)"
 * headers without a second fetch.
 */
watchlistGroupsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const groups = await prisma.watchlistGroup.findMany({
      where: { userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { cards: true } },
      },
    });
    res.json({
      groups: groups.map((g) => ({
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        cardCount: g._count.cards,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/watchlist-groups — create a new group. sortOrder defaults to
 * the current max + 1 so new groups always append to the bottom of the
 * picker order.
 */
watchlistGroupsRouter.post("/", async (req, res, next) => {
  try {
    const { name } = createSchema.parse(req.body);
    const userId = req.user!.userId;

    const last = await prisma.watchlistGroup.findFirst({
      where: { userId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const nextSortOrder = last ? last.sortOrder + 1 : 0;

    const group = await prisma.watchlistGroup.create({
      data: { userId, name, sortOrder: nextSortOrder },
      select: {
        id: true,
        name: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.status(201).json({ ...group, cardCount: 0 });
  } catch (err) {
    if (uniqueNameViolation(err)) {
      return next(new AppError(409, "A group with that name already exists"));
    }
    next(err);
  }
});

/**
 * PATCH /api/watchlist-groups/:id — rename and/or change sortOrder.
 * Renaming to a duplicate name returns 409.
 */
watchlistGroupsRouter.patch("/:id", async (req, res, next) => {
  try {
    const updates = updateSchema.parse(req.body);

    const existing = await prisma.watchlistGroup.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "Group not found");

    const group = await prisma.watchlistGroup.update({
      where: { id: req.params.id },
      data: updates,
      select: {
        id: true,
        name: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { cards: true } },
      },
    });
    res.json({
      id: group.id,
      name: group.name,
      sortOrder: group.sortOrder,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      cardCount: group._count.cards,
    });
  } catch (err) {
    if (uniqueNameViolation(err)) {
      return next(new AppError(409, "A group with that name already exists"));
    }
    next(err);
  }
});

/**
 * DELETE /api/watchlist-groups/:id — drop the group. Member cards are
 * preserved and orphan to "Ungrouped" (groupId=null) via the schema's
 * SetNull rule.
 */
watchlistGroupsRouter.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.watchlistGroup.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
      select: { id: true },
    });
    if (!existing) throw new AppError(404, "Group not found");

    await prisma.watchlistGroup.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
