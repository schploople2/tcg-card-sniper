import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import { getVapidPublicKey } from "../services/pushNotifier.js";

/**
 * B2 — Web Push subscription endpoints.
 *
 *   GET  /api/push/vapid-public-key  → { publicKey: string | null }
 *                                       (null = push disabled on server)
 *   POST /api/push/subscribe         { endpoint, keys: { p256dh, auth } }
 *                                       upsert by endpoint
 *   DELETE /api/push/subscribe       { endpoint }
 *                                       remove by endpoint
 */

export const pushRouter = Router();

// VAPID key is public — the client needs it to subscribe — but we still
// require auth so anonymous traffic can't poll the server for env shape.
pushRouter.use(requireAuth);

pushRouter.get("/vapid-public-key", (_req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

pushRouter.post("/subscribe", async (req, res, next) => {
  try {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid subscription payload");
    }
    const { endpoint, keys } = parsed.data;
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId: req.user!.userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      update: {
        // Re-subscribing from the same device under a different account
        // should re-assign the subscription rather than orphan it.
        userId: req.user!.userId,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
    });
    res.json({ ok: true, id: sub.id });
  } catch (err) {
    next(err);
  }
});

const unsubscribeSchema = z.object({ endpoint: z.string().url() });

pushRouter.delete("/subscribe", async (req, res, next) => {
  try {
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "Invalid unsubscribe payload");
    }
    const result = await prisma.pushSubscription.deleteMany({
      where: {
        endpoint: parsed.data.endpoint,
        userId: req.user!.userId,
      },
    });
    res.json({ deleted: result.count });
  } catch (err) {
    next(err);
  }
});
