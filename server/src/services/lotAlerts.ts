import type { Lot } from "@prisma/client";
import { AlertKind } from "@prisma/client";
import { prisma } from "../db.js";
import {
  buildLotAlertEmbed,
  buildMistitledEmbed,
  postToDiscord,
  type LotAlertEmbedInput,
  type MistitledAlertEmbedInput,
} from "./discordNotifier.js";
import { matchUsersForLot } from "./savedLotSearches.js";
import { computeMistitledScore } from "./mistitledScore.js";

/**
 * A1 — Lot-tied alerts.
 *
 * Called after every OCR write-back (persistOcrToLot). Checks whether the
 * lot's freshly-computed value range justifies firing a LOT_HOT alert and,
 * if so, creates one Alert row per opted-in user and fans out via the
 * existing Discord webhook pipeline (B1).
 *
 * Threshold criteria (must all hold):
 *   - lot.lotTier === "HOT"  → already filters for ≥25% headline savings
 *   - lot.lowEstimate ≥ FLOOR_MULTIPLE × lot.listingPrice
 *   - lot.lowEstimate ≥ MIN_LOW_USD (don't fire for $1 lots even at 10×)
 *   - dedup: at most one LOT_HOT per (user, lotEbayItemId, kind) — enforced
 *     by the unique index Alert_userId_lotEbayItemId_kind_key.
 *
 * v1 fires for ALL users (no per-user opt-out beyond the future saved-search
 * filter in B4). Single-user dev today; multi-user gating belongs with B4.
 */

// Thresholds for LOT_HOT alert firing. Defaults are conservative;
// overridable via env (LOT_ALERT_FLOOR_MULTIPLE, LOT_ALERT_MIN_LOW_USD,
// LOT_ALERT_REQUIRE_HOT_TIER) for live verification and tuning without
// a code change + deploy cycle. Defaults survive when env is unset.
const FLOOR_MULTIPLE = Number(process.env.LOT_ALERT_FLOOR_MULTIPLE ?? 2.0);
const MIN_LOW_USD = Number(process.env.LOT_ALERT_MIN_LOW_USD ?? 20);
const REQUIRE_HOT_TIER =
  (process.env.LOT_ALERT_REQUIRE_HOT_TIER ?? "true").toLowerCase() !== "false";

export interface LotAlertEvalResult {
  /** Did the lot qualify after the threshold check? */
  qualified: boolean;
  /** Number of Alert rows actually created (after dedup). */
  alertsCreated: number;
}

export async function evaluateLotAfterOcr(
  ebayItemId: string
): Promise<LotAlertEvalResult> {
  const lot = await prisma.lot.findUnique({ where: { ebayItemId } });
  if (!lot) return { qualified: false, alertsCreated: 0 };

  const lowEstimate = Number(lot.lowEstimate);
  const listingPrice = Number(lot.listingPrice);

  if (REQUIRE_HOT_TIER && lot.lotTier !== "HOT") {
    return { qualified: false, alertsCreated: 0 };
  }
  if (lowEstimate < MIN_LOW_USD) return { qualified: false, alertsCreated: 0 };
  if (listingPrice <= 0) return { qualified: false, alertsCreated: 0 };
  if (lowEstimate < FLOOR_MULTIPLE * listingPrice) {
    return { qualified: false, alertsCreated: 0 };
  }

  // B4 — fire only to users whose SavedLotSearch matches this lot.
  // Replaces the v1 "fire to every user" behavior; users with no saved
  // searches get no lot alerts (the opt-in model).
  const userIds = await matchUsersForLot({
    title: lot.title,
    lowEstimate: lot.lowEstimate,
    listingPrice: lot.listingPrice,
  });
  if (userIds.length === 0) return { qualified: true, alertsCreated: 0 };

  const candidates = userIds.map((id) => ({
    userId: id,
    lotEbayItemId: ebayItemId,
    kind: AlertKind.LOT_HOT,
  }));

  // Find which alerts already exist BEFORE the insert (so we know which
  // are novel for Discord fan-out — same pattern as services/alerts.ts).
  const existing = await prisma.alert.findMany({
    where: {
      lotEbayItemId: ebayItemId,
      kind: AlertKind.LOT_HOT,
      userId: { in: userIds },
    },
    select: { userId: true },
  });
  const existingByUser = new Set(existing.map((e) => e.userId));
  const novel = candidates.filter((c) => !existingByUser.has(c.userId));

  const result = await prisma.alert.createMany({
    data: candidates,
    skipDuplicates: true,
  });

  if (novel.length > 0) {
    void fanOutDiscord(
      lot,
      novel.map((n) => n.userId)
    );
  }

  return { qualified: true, alertsCreated: result.count };
}

/**
 * Look up Discord webhook URLs for each user, build the LOT_HOT embed
 * from the lot row, and POST. Best-effort — errors logged, never
 * propagated. Mirrors fanOutDiscord in services/alerts.ts.
 */
async function fanOutDiscord(lot: Lot, userIds: string[]): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, discordWebhookUrl: true },
    });

    // Build embed once — same lot for all users.
    interface ParsedCardLite {
      name?: unknown;
      candidates?: unknown;
    }
    interface CandidateLite {
      market?: unknown;
    }
    const parsedCards: ParsedCardLite[] = Array.isArray(lot.parsedCards)
      ? (lot.parsedCards as ParsedCardLite[])
      : [];
    // Top cards by max-market candidate — gives Discord viewers a quick
    // "what's actually inside" preview without scrolling the full list.
    const ranked = parsedCards
      .map((p) => {
        const cands: CandidateLite[] = Array.isArray(p.candidates)
          ? (p.candidates as CandidateLite[])
          : [];
        const maxMarket = cands.reduce<number>((m, c) => {
          const v = typeof c.market === "number" ? c.market : 0;
          return v > m ? v : m;
        }, 0);
        const name = typeof p.name === "string" ? p.name : null;
        return { name, maxMarket };
      })
      .filter((r): r is { name: string; maxMarket: number } => !!r.name)
      .sort((a, b) => b.maxMarket - a.maxMarket);

    const embedInput: LotAlertEmbedInput = {
      lotTitle: lot.title,
      lotUrl: lot.ebayUrl,
      imageUrl: lot.imageUrl ?? null,
      askingPrice: Number(lot.listingPrice),
      lowEstimate: Number(lot.lowEstimate),
      highEstimate: Number(lot.highEstimate),
      parsedCardCount: parsedCards.length,
      topCardNames: ranked.slice(0, 6).map((r) => r.name),
    };
    const payload = buildLotAlertEmbed(embedInput);

    for (const u of users) {
      if (!u.discordWebhookUrl) continue;
      const result = await postToDiscord(u.discordWebhookUrl, payload);
      if (!result.ok) {
        console.error(
          `[lotAlerts:discord] user=${u.id} lot=${lot.ebayItemId} failed: ${
            result.error ?? `status ${result.status}`
          }`
        );
      }
    }
  } catch (err) {
    console.error(
      "[lotAlerts:discord] fanOutDiscord crashed:",
      err instanceof Error ? err.message : err
    );
  }
}

// ─── A2: Mis-titled lot alerts ─────────────────────────────────────────────────

const MISTITLED_MIN_HIDDEN_USD = Number(
  process.env.LOT_ALERT_MISTITLED_MIN_USD ?? 30
);

export interface MistitledEvalResult {
  qualified: boolean;
  hiddenUsd: number;
  alertsCreated: number;
}

/**
 * A2 — Fire MISTITLED alerts for lots whose photo content has significant
 * value the title fails to mention. Run after every OCR write-back along
 * with evaluateLotAfterOcr; same scoping (matchUsersForLot from B4), same
 * fan-out shape (createMany + best-effort Discord), distinct embed.
 *
 * Doesn't block on Discord fan-out — caller can `void`-prefix.
 */
export async function evaluateLotForMistitling(
  ebayItemId: string
): Promise<MistitledEvalResult> {
  const lot = await prisma.lot.findUnique({ where: { ebayItemId } });
  if (!lot) return { qualified: false, hiddenUsd: 0, alertsCreated: 0 };

  const score = computeMistitledScore({
    title: lot.title,
    parsedCards: lot.parsedCards,
  });
  if (score.hiddenUsd < MISTITLED_MIN_HIDDEN_USD) {
    return { qualified: false, hiddenUsd: score.hiddenUsd, alertsCreated: 0 };
  }

  const userIds = await matchUsersForLot({
    title: lot.title,
    lowEstimate: lot.lowEstimate,
    listingPrice: lot.listingPrice,
  });
  if (userIds.length === 0) {
    return { qualified: true, hiddenUsd: score.hiddenUsd, alertsCreated: 0 };
  }

  const candidates = userIds.map((id) => ({
    userId: id,
    lotEbayItemId: ebayItemId,
    kind: AlertKind.MISTITLED,
  }));

  const existing = await prisma.alert.findMany({
    where: {
      lotEbayItemId: ebayItemId,
      kind: AlertKind.MISTITLED,
      userId: { in: userIds },
    },
    select: { userId: true },
  });
  const existingByUser = new Set(existing.map((e) => e.userId));
  const novel = candidates.filter((c) => !existingByUser.has(c.userId));

  const result = await prisma.alert.createMany({
    data: candidates,
    skipDuplicates: true,
  });

  if (novel.length > 0) {
    void fanOutMistitledDiscord(lot, score, novel.map((n) => n.userId));
  }

  return {
    qualified: true,
    hiddenUsd: score.hiddenUsd,
    alertsCreated: result.count,
  };
}

async function fanOutMistitledDiscord(
  lot: Lot,
  score: ReturnType<typeof computeMistitledScore>,
  userIds: string[]
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, discordWebhookUrl: true },
    });
    const embedInput: MistitledAlertEmbedInput = {
      lotTitle: lot.title,
      lotUrl: lot.ebayUrl,
      imageUrl: lot.imageUrl ?? null,
      askingPrice: Number(lot.listingPrice),
      hiddenUsd: score.hiddenUsd,
      hidden: score.hidden.map((h) => ({
        name: h.name,
        quantity: h.quantity,
        totalValue: h.totalValue,
      })),
    };
    const payload = buildMistitledEmbed(embedInput);

    for (const u of users) {
      if (!u.discordWebhookUrl) continue;
      const result = await postToDiscord(u.discordWebhookUrl, payload);
      if (!result.ok) {
        console.error(
          `[mistitled:discord] user=${u.id} lot=${lot.ebayItemId} failed: ${
            result.error ?? `status ${result.status}`
          }`
        );
      }
    }
  } catch (err) {
    console.error(
      "[mistitled:discord] fanOut crashed:",
      err instanceof Error ? err.message : err
    );
  }
}
