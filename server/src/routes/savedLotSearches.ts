import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const savedLotSearchesRouter = Router();
savedLotSearchesRouter.use(requireAuth);

/**
 * B4 — CRUD for per-user saved lot searches.
 *
 * Authz: every endpoint scopes to req.user!.userId. The unique index on
 * (userId, query) prevents duplicate saves of the same query string.
 */

const createSchema = z.object({
  query: z.string().min(2).max(200),
  minLowEstimate: z.number().positive().nullable().optional(),
  maxAskingPrice: z.number().positive().nullable().optional(),
});

/** GET /api/saved-lot-searches — list current user's saved searches. */
savedLotSearchesRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.savedLotSearch.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        query: true,
        minLowEstimate: true,
        maxAskingPrice: true,
        createdAt: true,
        lastEvaluatedAt: true,
      },
    });
    res.json({ savedSearches: rows });
  } catch (err) {
    next(err);
  }
});

/** POST /api/saved-lot-searches — create. */
savedLotSearchesRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const row = await prisma.savedLotSearch.create({
      data: {
        userId: req.user!.userId,
        query: parsed.query.trim(),
        minLowEstimate: parsed.minLowEstimate ?? null,
        maxAskingPrice: parsed.maxAskingPrice ?? null,
      },
      select: {
        id: true,
        query: true,
        minLowEstimate: true,
        maxAskingPrice: true,
        createdAt: true,
        lastEvaluatedAt: true,
      },
    });
    res.status(201).json(row);
  } catch (err) {
    // Prisma unique-violation on (userId, query) → friendlier message.
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return next(new AppError(409, "You already have this saved search"));
    }
    next(err);
  }
});

/** DELETE /api/saved-lot-searches/:id — delete one. */
savedLotSearchesRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await prisma.savedLotSearch.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (result.count === 0) throw new AppError(404, "Saved search not found");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
