import webPush from "web-push";
import type { AlertKind } from "@prisma/client";
import { prisma } from "../db.js";
import { config } from "../config.js";

/**
 * B2 — Web Push fan-out.
 *
 * Sends a notification to every PushSubscription rows for a user. Each
 * Alert kind has its own title/body shape; the click URL always points at
 * the eBay listing so a one-tap from the notification lands the user on
 * the buying action.
 *
 * Lifecycle: when web-push returns 404/410 for a subscription, the
 * endpoint is dead (uninstalled PWA, revoked permission, rotated). We
 * delete the row so we stop trying.
 */

let _configured = false;

function pushEnabled(): boolean {
  return !!(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);
}

function ensureConfigured(): boolean {
  if (!pushEnabled()) return false;
  if (_configured) return true;
  webPush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY!,
    config.VAPID_PRIVATE_KEY!
  );
  _configured = true;
  return true;
}

export interface PushPayload {
  /** Title shown in the system notification UI. */
  title: string;
  /** Body shown below the title. */
  body: string;
  /** URL the browser opens on notification click. */
  url: string;
  /** Tag — same tag replaces the previous notification rather than stacking. */
  tag?: string;
}

const KIND_TITLES: Record<AlertKind, string> = {
  TARGET_HIT: "🎯 Target hit",
  HOT_DEAL: "🔥 Hot deal",
  LOT_HOT: "💎 Hot lot",
  MISTITLED: "🕵️ Mis-titled lot",
  SELLER_LISTING: "👤 Watched seller",
};

/**
 * Send one payload to every device subscription for one user. Returns the
 * number of successful deliveries. Failures don't throw — push delivery
 * is best-effort and the in-app bell + Discord are independent channels.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<number> {
  if (!ensureConfigured()) return 0;

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  let delivered = 0;
  const deadIds: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body
        );
        delivered += 1;
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
        // 404 = endpoint gone (FCM cleaned it up); 410 = subscription expired
        // or unsubscribed at the OS level. In both cases the subscription is
        // dead and we should drop it. Anything else is transient — keep the row.
        if (code === 404 || code === 410) {
          deadIds.push(s.id);
        }
        console.error(
          `[pushNotifier] send failed (status=${code}):`,
          err instanceof Error ? err.message : err
        );
      }
    })
  );

  if (deadIds.length > 0) {
    await prisma.pushSubscription
      .deleteMany({ where: { id: { in: deadIds } } })
      .catch((err) =>
        console.error("[pushNotifier] cleanup failed:", err)
      );
  }

  return delivered;
}

interface ListingForPush {
  title: string;
  ebayUrl: string;
  totalCost: number;
  marketPrice: number | null;
}

export function buildListingPushPayload(
  kind: "TARGET_HIT" | "HOT_DEAL" | "SELLER_LISTING",
  cardName: string,
  listing: ListingForPush
): PushPayload {
  const discount =
    listing.marketPrice && listing.marketPrice > 0
      ? Math.round(((listing.marketPrice - listing.totalCost) / listing.marketPrice) * 100)
      : null;
  const priceLine =
    discount !== null && discount > 0
      ? `$${listing.totalCost.toFixed(2)} (${discount}% off $${listing.marketPrice!.toFixed(2)})`
      : `$${listing.totalCost.toFixed(2)}`;
  return {
    title: `${KIND_TITLES[kind]} — ${cardName}`,
    body: `${priceLine}\n${listing.title.slice(0, 90)}`,
    url: listing.ebayUrl,
    tag: `${kind}:${listing.ebayUrl}`,
  };
}

interface LotForPush {
  title: string;
  ebayItemId: string;
  listingPrice: number;
  lowEstimate?: number;
  highEstimate?: number;
}

export function buildLotPushPayload(
  kind: "LOT_HOT" | "MISTITLED",
  lot: LotForPush,
  extra?: { hiddenUsd?: number }
): PushPayload {
  const itemNumber = lot.ebayItemId.split("|")[1] ?? lot.ebayItemId;
  const ebayUrl = `https://www.ebay.com/itm/${itemNumber}`;
  let body: string;
  if (kind === "LOT_HOT" && lot.lowEstimate) {
    const multiple = (lot.lowEstimate / lot.listingPrice).toFixed(1);
    body = `Estimated $${lot.lowEstimate.toFixed(0)}+ at $${lot.listingPrice.toFixed(
      2
    )} asking (${multiple}× value)\n${lot.title.slice(0, 80)}`;
  } else if (kind === "MISTITLED" && extra?.hiddenUsd) {
    body = `$${extra.hiddenUsd.toFixed(0)}+ hidden value in a generic title\n${lot.title.slice(0, 80)}`;
  } else {
    body = lot.title.slice(0, 120);
  }
  return {
    title: `${KIND_TITLES[kind]} — $${lot.listingPrice.toFixed(2)}`,
    body,
    url: ebayUrl,
    tag: `${kind}:${lot.ebayItemId}`,
  };
}

export function getVapidPublicKey(): string | null {
  return config.VAPID_PUBLIC_KEY ?? null;
}
