/**
 * B1 — Fire-and-forget Discord webhook notifications for alerts.
 *
 * Each user can save a Discord webhook URL via /api/settings. When an
 * alert is created in services/alerts.ts, we look up that URL and POST
 * an embed. The webhook call is best-effort: failures are logged but
 * never block alert creation (the in-app bell remains the source of
 * truth; Discord is a delivery channel).
 *
 * Discord webhook docs: https://discord.com/developers/docs/resources/webhook
 */

import { AlertKind } from "@prisma/client";

const WEBHOOK_TIMEOUT_MS = 5000;

/**
 * Lightweight regex for Discord's two valid webhook URL hosts. Doesn't
 * fully validate the ID/token but catches the common copy-paste mistakes
 * (truncation, wrong scheme, leading whitespace). Discord's real check
 * happens when we POST.
 */
const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:discord(?:app)?\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+\/?$/;

export function isValidDiscordWebhookUrl(url: string): boolean {
  return DISCORD_WEBHOOK_URL_RE.test(url.trim());
}

/**
 * Reduce a webhook URL to its last 10 characters so the UI can show
 * "…abcdef1234" as proof we have it stored without leaking the secret.
 */
export function redactWebhookUrl(url: string | null): string | null {
  if (!url) return null;
  const tail = url.slice(-10);
  return `…${tail}`;
}

export interface AlertEmbedInput {
  kind: AlertKind;
  cardName: string;
  variant: string | null;
  /** eBay listing title to render as the embed title. */
  listingTitle: string;
  listingUrl: string;
  /** Image URL — usually the listing photo, not the catalog card art. */
  imageUrl: string | null;
  /** Total cost including shipping, in USD. */
  totalCost: number;
  /** Market price reference at the time of alert, in USD. */
  marketPrice: number | null;
  /** Optional condition (NM/LP/MP/HP/DMG/GRADED). */
  condition: string | null;
  /** "HOT"/"GOOD"/etc — drives embed color. */
  dealTier: string | null;
}

/** Discord embed colors by deal tier (decimal RGB, what Discord expects). */
const TIER_COLORS: Record<string, number> = {
  HOT: 0xff5722, // orange
  GOOD: 0x4caf50, // green
  FAIR: 0xffc107, // amber
  OVER: 0x9e9e9e, // grey
  UNSCORED: 0x607d8b, // blue-grey
};

const KIND_LABEL: Record<AlertKind, string> = {
  TARGET_HIT: "🎯 Target price hit",
  HOT_DEAL: "🔥 Hot deal",
  LOT_HOT: "💎 Under-priced lot",
  MISTITLED: "🕵️ Hidden cards in lot",
  SELLER_LISTING: "👤 Watched seller listed",
};

/**
 * Build the JSON body for a Discord webhook execute. One alert → one
 * embed. Keeps the message short — Discord embeds max out at 6000 chars
 * but the social signal here is "a card you care about just went on
 * sale", not a full report.
 */
export function buildAlertEmbed(input: AlertEmbedInput): Record<string, unknown> {
  const color =
    input.dealTier && TIER_COLORS[input.dealTier] !== undefined
      ? TIER_COLORS[input.dealTier]
      : TIER_COLORS.UNSCORED;

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Price", value: `$${input.totalCost.toFixed(2)}`, inline: true },
  ];
  if (input.marketPrice != null) {
    fields.push({
      name: "Market",
      value: `$${input.marketPrice.toFixed(2)}`,
      inline: true,
    });
    const delta = ((input.marketPrice - input.totalCost) / input.marketPrice) * 100;
    fields.push({
      name: "Savings",
      value: `${delta > 0 ? "+" : ""}${delta.toFixed(0)}%`,
      inline: true,
    });
  }
  if (input.condition) {
    fields.push({ name: "Condition", value: input.condition, inline: true });
  }
  if (input.variant) {
    fields.push({ name: "Variant", value: input.variant, inline: true });
  }

  return {
    username: "TCG Card Sniper",
    embeds: [
      {
        title: input.listingTitle.slice(0, 256), // Discord cap
        url: input.listingUrl,
        description: `**${KIND_LABEL[input.kind]}** — ${input.cardName}`,
        color,
        fields,
        thumbnail: input.imageUrl ? { url: input.imageUrl } : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

export interface PostResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * POST a payload to a Discord webhook. 5s timeout. Doesn't throw on
 * non-2xx — returns { ok: false, status, error } so the caller can log
 * without crashing. Use `validateWebhookUrl` first to avoid wasting a
 * request on an obvious typo.
 */
export async function postToDiscord(
  url: string,
  payload: Record<string, unknown>
): Promise<PostResult> {
  if (!isValidDiscordWebhookUrl(url)) {
    return { ok: false, error: "invalid webhook URL format" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return { ok: false, status: resp.status, error: text.slice(0, 200) };
    }
    return { ok: true, status: resp.status };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.name === "AbortError"
            ? "timeout"
            : err.message
          : "unknown error",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Lot alerts (A1) ─────────────────────────────────────────────────────────

export interface LotAlertEmbedInput {
  /** eBay listing title (the lot's title). */
  lotTitle: string;
  lotUrl: string;
  /** Listing thumbnail URL — eBay's hero shot for this lot. */
  imageUrl: string | null;
  askingPrice: number;
  lowEstimate: number;
  highEstimate: number;
  /** Number of distinct parsed-card entries found by Vision OCR. */
  parsedCardCount: number;
  /** Optional preview list of top card names by market value, e.g.
   *  ["Mew VMAX", "Suicune V"] — rendered in a "Top cards" field. */
  topCardNames: string[];
}

/**
 * A1 — embed for LOT_HOT alerts. Visually distinct from card alerts
 * (purple border, 💎 emoji) so they're easy to scan in a busy channel.
 */
export function buildLotAlertEmbed(input: LotAlertEmbedInput): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Asking", value: `$${input.askingPrice.toFixed(2)}`, inline: true },
    { name: "Low est.", value: `$${input.lowEstimate.toFixed(2)}`, inline: true },
    { name: "High est.", value: `$${input.highEstimate.toFixed(2)}`, inline: true },
    {
      name: "Cards parsed",
      value: String(input.parsedCardCount),
      inline: true,
    },
  ];
  if (input.lowEstimate > 0 && input.askingPrice > 0) {
    const multiple = input.lowEstimate / input.askingPrice;
    fields.push({
      name: "Floor multiple",
      value: `${multiple.toFixed(1)}×`,
      inline: true,
    });
  }
  if (input.topCardNames.length > 0) {
    fields.push({
      name: "Top cards",
      value: input.topCardNames.slice(0, 6).join(", ").slice(0, 1024),
    });
  }
  return {
    username: "TCG Card Sniper",
    embeds: [
      {
        title: input.lotTitle.slice(0, 256),
        url: input.lotUrl,
        description: `**${KIND_LABEL.LOT_HOT}** — worth $${input.lowEstimate.toFixed(0)}–$${input.highEstimate.toFixed(0)} vs $${input.askingPrice.toFixed(0)} asking`,
        color: 0x9c27b0, // purple — distinct from HOT_DEAL orange
        fields,
        thumbnail: input.imageUrl ? { url: input.imageUrl } : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// ─── Mistitled lot alerts (A2) ────────────────────────────────────────────────

export interface MistitledAlertEmbedInput {
  lotTitle: string;
  lotUrl: string;
  imageUrl: string | null;
  askingPrice: number;
  /** Total USD of cards the vision pass found that aren't named in the title. */
  hiddenUsd: number;
  /** Top hidden cards, already sorted desc by totalValue. UI shows up to 6. */
  hidden: Array<{ name: string; quantity: number; totalValue: number }>;
}

/**
 * A2 — magenta/pink embed for MISTITLED alerts. The framing is "did the
 * seller leave money on the table by under-describing this lot?" rather
 * than the LOT_HOT framing of "good deal across the board". Color is
 * distinct from LOT_HOT purple so the two are scannable in Discord.
 */
export function buildMistitledEmbed(input: MistitledAlertEmbedInput): Record<string, unknown> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Asking", value: `$${input.askingPrice.toFixed(2)}`, inline: true },
    { name: "Hidden value", value: `$${input.hiddenUsd.toFixed(2)}`, inline: true },
    {
      name: "Title gap multiple",
      value: input.askingPrice > 0
        ? `${(input.hiddenUsd / input.askingPrice).toFixed(1)}×`
        : "—",
      inline: true,
    },
  ];
  if (input.hidden.length > 0) {
    const list = input.hidden
      .slice(0, 6)
      .map((h) => {
        const qtyPart = h.quantity > 1 ? `${h.quantity}× ` : "";
        return `${qtyPart}${h.name} ($${h.totalValue.toFixed(0)})`;
      })
      .join("\n");
    fields.push({
      name: "Cards not mentioned in title",
      value: list.slice(0, 1024),
    });
  }

  return {
    username: "TCG Card Sniper",
    embeds: [
      {
        title: input.lotTitle.slice(0, 256),
        url: input.lotUrl,
        description: `**${KIND_LABEL.MISTITLED}** — $${input.hiddenUsd.toFixed(0)} of cards not named in the title`,
        color: 0xe91e63, // pink/magenta — distinct from LOT_HOT purple + HOT_DEAL orange
        fields,
        thumbnail: input.imageUrl ? { url: input.imageUrl } : undefined,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Fire a tiny "this is working" message — used by the /api/settings/test-webhook
 * endpoint so the user can verify their URL before relying on it for alerts.
 */
export function buildTestEmbed(): Record<string, unknown> {
  return {
    username: "TCG Card Sniper",
    embeds: [
      {
        title: "✅ Test alert from TCG Card Sniper",
        description:
          "Your Discord webhook is wired up correctly. " +
          "Future alerts (target-price hits and HOT deals) will appear here.",
        color: 0x4caf50,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
