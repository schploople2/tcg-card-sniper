import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";

export const alertsRouter = Router();
alertsRouter.use(requireAuth);

/**
 * Alerts endpoints — feeds the bell + drawer UI (P4) and a future email
 * digest job (deferred P11+).
 *
 * Authz: every endpoint scopes to req.user!.userId. The Alert.userId column
 * is denormalised exactly so this lookup is a single indexed read.
 */

const listQuerySchema = z.object({
  /** Only return unread when true. Default: show everything from last 30 days. */
  unread: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /api/alerts?unread=true&limit=50
 *
 * Returns alerts joined with their watched-card snapshot (name/setName/number)
 * and listing snapshot (title/totalCost/ebayUrl/imageUrl) so the UI can
 * render a useful card without N+1 fetches. Listings rotate every 30 min;
 * for alerts whose listing has already expired we still return the alert
 * row with `listing: null` and a `listingExpired: true` flag.
 */
alertsRouter.get("/", async (req, res, next) => {
  try {
    const { unread, limit } = listQuerySchema.parse(req.query);

    const alerts = await prisma.alert.findMany({
      where: {
        userId: req.user!.userId,
        ...(unread ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        card: {
          select: {
            id: true,
            cardName: true,
            setName: true,
            cardNumber: true,
            variant: true,
            targetPrice: true,
          },
        },
      },
    });

    // A1: alerts can now be lot-tied (listingId NULL) — skip those when
    // fetching listing snapshots.
    const listingIds = alerts
      .map((a) => a.listingId)
      .filter((id): id is string => id !== null);
    const listings = listingIds.length
      ? await prisma.listing.findMany({
          where: { id: { in: listingIds } },
          select: {
            id: true,
            title: true,
            imageUrl: true,
            ebayUrl: true,
            totalCost: true,
            dealTier: true,
            dealScore: true,
            condition: true,
            conditionGrade: true,
            expiresAt: true,
          },
        })
      : [];

    const listingById = new Map(listings.map((l) => [l.id, l]));

    res.json({
      alerts: alerts.map((a) => {
        const listing = a.listingId ? listingById.get(a.listingId) ?? null : null;
        return {
          id: a.id,
          kind: a.kind,
          readAt: a.readAt,
          createdAt: a.createdAt,
          card: a.card,
          listing,
          // A1: include lot pointer when this is a lot-tied alert.
          lotEbayItemId: a.lotEbayItemId,
          listingExpired: a.listingId !== null && listing === null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/alerts/count — lightweight badge endpoint.
 * Returns `{ unread: N }`. Used by the bell badge in TopNav — we want a fast
 * single-COUNT query rather than the full payload.
 */
alertsRouter.get("/count", async (req, res, next) => {
  try {
    const unread = await prisma.alert.count({
      where: { userId: req.user!.userId, readAt: null },
    });
    res.json({ unread });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/alerts/:id/read — mark a single alert read.
 */
alertsRouter.patch("/:id/read", async (req, res, next) => {
  try {
    const alert = await prisma.alert.findFirst({
      where: { id: req.params.id, userId: req.user!.userId },
    });
    if (!alert) throw new AppError(404, "Alert not found");

    if (alert.readAt !== null) {
      // Idempotent — return current state without an extra write.
      return res.json({ id: alert.id, readAt: alert.readAt });
    }

    const updated = await prisma.alert.update({
      where: { id: alert.id },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/alerts/read-all — mark every unread alert read.
 * Returns the count actually updated so the UI can flash a toast.
 */
alertsRouter.post("/read-all", async (req, res, next) => {
  try {
    const result = await prisma.alert.updateMany({
      where: { userId: req.user!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  } catch (err) {
    next(err);
  }
});
