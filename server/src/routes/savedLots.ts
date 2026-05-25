import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const savedLotsRouter = Router();
savedLotsRouter.use(requireAuth);

/**
 * u8y — Per-user saved (pinned) lot listings.
 *
 * Snapshots title / image / url / listingPrice at save time so the saved
 * list survives the underlying Lot row's 30-minute TTL. Every endpoint
 * scopes to req.user!.userId; the (userId, ebayItemId) unique constraint
 * keeps the same lot from being pinned twice.
 */

const SELECT = {
  id: true,
  ebayItemId: true,
  title: true,
  imageUrl: true,
  ebayUrl: true,
  listingPrice: true,
  note: true,
  createdAt: true,
} as const;

const createSchema = z.object({
  ebayItemId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  imageUrl: z.string().url().max(2048).nullable().optional(),
  ebayUrl: z.string().url().max(2048),
  // Accept number, or numeric string from a form; coerce both into a number.
  listingPrice: z.coerce.number().nonnegative(),
  note: z.string().max(500).nullable().optional(),
});

savedLotsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.savedLot.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: SELECT,
    });
    res.json({ savedLots: rows });
  } catch (err) {
    next(err);
  }
});

savedLotsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const row = await prisma.savedLot.create({
      data: {
        userId: req.user!.userId,
        ebayItemId: parsed.ebayItemId,
        title: parsed.title,
        imageUrl: parsed.imageUrl ?? null,
        ebayUrl: parsed.ebayUrl,
        listingPrice: parsed.listingPrice,
        note: parsed.note ?? null,
      },
      select: SELECT,
    });
    res.status(201).json(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return next(new AppError(409, "You already saved this lot"));
    }
    next(err);
  }
});

savedLotsRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await prisma.savedLot.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (result.count === 0) throw new AppError(404, "Saved lot not found");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
