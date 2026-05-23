import type { Prisma, WatchedCard } from "@prisma/client";
import { AlertKind } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * Evaluate a batch of just-fetched listings against a watched card's
 * targetPrice and dealTier, and persist any new Alert rows.
 *
 * Called by the listings route and the refresh cron after each upsert
 * round. Idempotent via the `(cardId, listingId, kind)` unique index — if
 * a listing remains a HOT deal across many refreshes, only the first one
 * creates an Alert row.
 *
 * Two kinds today:
 *   - TARGET_HIT: listing's totalCost ≤ user's targetPrice. The simplest
 *                 mental model — "tell me when this drops to $X."
 *   - HOT_DEAL:   listing tier is HOT (≥25% below adjusted market). Fires
 *                 even when no target is set, so users with no specific
 *                 ceiling still hear about extreme bargains.
 *
 * Returns the number of Alert rows actually created (post-dedupe).
 */
export async function evaluateListings(
  card: Pick<WatchedCard, "id" | "userId" | "targetPrice">,
  listings: Array<{
    id: string;
    totalCost: Prisma.Decimal | number;
    dealTier: string;
  }>
): Promise<number> {
  if (listings.length === 0) return 0;

  const targetCents =
    card.targetPrice != null ? toCents(card.targetPrice) : null;

  // Build the candidate set first, then bulk-insert with skipDuplicates so
  // the unique index handles dedup atomically instead of in app code.
  const candidates: Array<{
    userId: string;
    cardId: string;
    listingId: string;
    kind: AlertKind;
  }> = [];

  for (const l of listings) {
    const totalCents = toCents(l.totalCost);

    if (targetCents !== null && totalCents <= targetCents) {
      candidates.push({
        userId: card.userId,
        cardId: card.id,
        listingId: l.id,
        kind: AlertKind.TARGET_HIT,
      });
    }
    if (l.dealTier === "HOT") {
      candidates.push({
        userId: card.userId,
        cardId: card.id,
        listingId: l.id,
        kind: AlertKind.HOT_DEAL,
      });
    }
  }

  if (candidates.length === 0) return 0;

  const result = await prisma.alert.createMany({
    data: candidates,
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Decimal-safe comparison. Prisma returns prices as `Prisma.Decimal` for
 * SQL Decimal columns; plain `Number(x)` works for typical card prices
 * (well under JS's 2^53 safe-int) but going via integer cents keeps the
 * comparison exact and matches our 2-decimal-place schema.
 */
function toCents(v: Prisma.Decimal | number): number {
  if (typeof v === "number") return Math.round(v * 100);
  return Math.round(Number(v) * 100);
}
