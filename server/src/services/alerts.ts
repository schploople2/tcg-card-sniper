import type { Prisma, WatchedCard } from "@prisma/client";
import { AlertKind } from "@prisma/client";
import { prisma } from "../db.js";
import {
  buildAlertEmbed,
  postToDiscord,
  type AlertEmbedInput,
} from "./discordNotifier.js";

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

  // Figure out which candidates would actually be new BEFORE the
  // insert, so we know precisely which ones to fan out to Discord.
  // Using the unique index columns (cardId, listingId, kind).
  const existing = await prisma.alert.findMany({
    where: {
      cardId: card.id,
      OR: candidates.map((c) => ({
        listingId: c.listingId,
        kind: c.kind,
      })),
    },
    select: { listingId: true, kind: true },
  });
  const existingKey = new Set(existing.map((e) => `${e.listingId}::${e.kind}`));
  const novel = candidates.filter(
    (c) => !existingKey.has(`${c.listingId}::${c.kind}`)
  );

  const result = await prisma.alert.createMany({
    data: candidates,
    skipDuplicates: true,
  });

  // Fan-out Discord webhook posts for the novel alerts. Fire-and-forget;
  // failures are logged but never block the alert path.
  if (novel.length > 0) {
    void fanOutDiscord(card.userId, novel.map((n) => ({ listingId: n.listingId, kind: n.kind })));
  }

  return result.count;
}

/**
 * B1 — Look up the user's Discord webhook URL and (if set) POST one embed
 * per just-created alert. Best-effort: any error is logged and swallowed
 * so it can't break the alert pipeline. Caller should `void`-prefix the
 * call so it doesn't block the response path.
 */
async function fanOutDiscord(
  userId: string,
  alerts: Array<{ listingId: string; kind: AlertKind }>
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { discordWebhookUrl: true },
    });
    if (!user?.discordWebhookUrl) return;

    const listingIds = [...new Set(alerts.map((a) => a.listingId))];
    const listings = await prisma.listing.findMany({
      where: { id: { in: listingIds } },
      include: {
        card: {
          select: { cardName: true, variant: true },
        },
      },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    for (const a of alerts) {
      const l = byId.get(a.listingId);
      if (!l) continue;
      const embed: AlertEmbedInput = {
        kind: a.kind,
        cardName: l.card?.cardName ?? "Pokémon card",
        variant: l.card?.variant ?? null,
        listingTitle: l.title,
        listingUrl: l.ebayUrl,
        imageUrl: l.imageUrl ?? null,
        totalCost: Number(l.totalCost),
        marketPrice: l.marketPrice != null ? Number(l.marketPrice) : null,
        condition: l.condition ?? null,
        dealTier: l.dealTier ?? null,
      };
      const result = await postToDiscord(user.discordWebhookUrl, buildAlertEmbed(embed));
      if (!result.ok) {
        console.error(
          `[alerts:discord] user=${userId} listing=${a.listingId} failed: ${
            result.error ?? `status ${result.status}`
          }`
        );
      }
    }
  } catch (err) {
    console.error(
      "[alerts:discord] fanOutDiscord crashed:",
      err instanceof Error ? err.message : err
    );
  }
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
