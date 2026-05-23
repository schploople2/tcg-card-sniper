import { Router } from "express";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { prisma } from "../db.js";

export const ebayDeletionRouter = Router();

/**
 * eBay Marketplace Account Deletion / Closure notifications.
 *
 * Two behaviors on the same path:
 *   GET  — eBay's endpoint-verification challenge handshake.
 *   POST — actual account-deletion notification payload.
 *
 * Spec: https://developer.ebay.com/marketplace-account-deletion
 */

// GET /ebay/account-deletion?challenge_code=...
ebayDeletionRouter.get("/", (req, res) => {
  const challengeCode = req.query.challenge_code;
  if (typeof challengeCode !== "string") {
    return res.status(400).json({ error: "missing challenge_code" });
  }

  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(config.EBAY_DELETION_VERIFICATION_TOKEN);
  hash.update(config.EBAY_DELETION_ENDPOINT_URL);
  const challengeResponse = hash.digest("hex");

  res.status(200).json({ challengeResponse });
});

// POST /ebay/account-deletion
ebayDeletionRouter.post("/", async (req, res) => {
  // Acknowledge fast — eBay retries aggressively if it doesn't see a 2xx.
  res.status(200).end();

  try {
    const username: string | undefined = req.body?.notification?.data?.username;
    const userId: string | undefined = req.body?.notification?.data?.userId;

    console.log("[ebay-deletion] received notification", { username, userId });

    if (!username && !userId) return;

    // Best-effort: purge any locally-stored data tied to this eBay user.
    // The schema does not yet store eBay user identifiers for buyers, so for now
    // this is a no-op aside from logging. When user-token storage lands, delete
    // the matching User row here.
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("[ebay-deletion] processing error", err);
  }
});
