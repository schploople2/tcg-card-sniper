import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const watchedSellersRouter = Router();
watchedSellersRouter.use(requireAuth);

/**
 * D2 — Per-user watched eBay seller usernames.
 *
 * Authz: every endpoint scopes to req.user!.userId. Unique index on
 * (userId, sellerName) prevents the same user from re-adding a seller.
 */

const createSchema = z.object({
  sellerName: z.string().min(1).max(100).trim(),
  note: z.string().max(200).nullable().optional(),
});

watchedSellersRouter.get("/", async (req, res, next) => {
  try {
    const rows = await prisma.watchedSeller.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, sellerName: true, note: true, createdAt: true },
    });
    res.json({ watchedSellers: rows });
  } catch (err) {
    next(err);
  }
});

watchedSellersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const row = await prisma.watchedSeller.create({
      data: {
        userId: req.user!.userId,
        sellerName: parsed.sellerName,
        note: parsed.note ?? null,
      },
      select: { id: true, sellerName: true, note: true, createdAt: true },
    });
    res.status(201).json(row);
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return next(new AppError(409, "You already watch this seller"));
    }
    next(err);
  }
});

watchedSellersRouter.delete("/:id", async (req, res, next) => {
  try {
    const result = await prisma.watchedSeller.deleteMany({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (result.count === 0) throw new AppError(404, "Watched seller not found");
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
