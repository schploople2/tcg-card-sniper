import axios from "axios";
import { config, EBAY_BASE_URL } from "../config.js";
import { prisma } from "../db.js";

/**
 * Fetch the full image set for an eBay listing and cache it in `LotImage`.
 *
 * eBay's Browse API `GET /buy/browse/v1/item/<id>` returns up to ~12
 * images: a hero shot (`image.imageUrl`) plus additional photos
 * (`additionalImages[].imageUrl`). The listing-search endpoint we already
 * use only returns the thumbnail — to power the analyzer modal we need
 * higher-res images and the full set.
 *
 * Caching by `(ebayItemId, position)` means a second request for the same
 * listing is a single DB read with no eBay round-trip.
 *
 * The `LotImage` table is also the future home of OCR text — when we wire
 * a vision pipeline, it'll fill in `ocrText` against the cached `imageUrl`.
 */

interface BrowseItemResponse {
  itemId: string;
  image?: { imageUrl: string };
  additionalImages?: Array<{ imageUrl: string }>;
}

// ─── Auth (reuses the same OAuth flow as the search endpoint) ────────────────

interface EbayToken {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: EbayToken | null = null;

async function getEbayAppToken(): Promise<string> {
  const BUFFER_MS = 5 * 60 * 1000;
  if (tokenCache && tokenCache.expiresAt - BUFFER_MS > Date.now()) {
    return tokenCache.accessToken;
  }
  const credentials = Buffer.from(
    `${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`
  ).toString("base64");
  const res = await axios.post<{ access_token: string; expires_in: number }>(
    `${EBAY_BASE_URL}/identity/v1/oauth2/token`,
    "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  tokenCache = {
    accessToken: res.data.access_token,
    expiresAt: Date.now() + res.data.expires_in * 1000,
  };
  return tokenCache.accessToken;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LotImageView {
  position: number;
  imageUrl: string;
}

/**
 * Get all images for a listing, fetching from eBay on cache miss.
 *
 * Cache lives forever (per `LotImage` row) — eBay listing images don't
 * change after the listing goes live. If a listing is edited the URL
 * would change but the itemId stays the same; in that rare case the user
 * would see the old images until we manually purge. Acceptable for v1.
 */
export async function getLotImages(ebayItemId: string): Promise<LotImageView[]> {
  // 1. Cache hit?
  const cached = await prisma.lotImage.findMany({
    where: { ebayItemId },
    orderBy: { position: "asc" },
    select: { position: true, imageUrl: true },
  });
  if (cached.length > 0) return cached;

  // 2. Cache miss — fetch from eBay.
  const token = await getEbayAppToken();
  // The Browse API itemId format is `v1|<numericId>|<variation>` — we
  // accept either form; if the caller passed the bare numeric id we wrap it.
  const id = ebayItemId.startsWith("v1|") ? ebayItemId : `v1|${ebayItemId}|0`;

  let res;
  try {
    res = await axios.get<BrowseItemResponse>(
      `${EBAY_BASE_URL}/buy/browse/v1/item/${encodeURIComponent(id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        },
        timeout: 8000,
      }
    );
  } catch (err) {
    // 404 = listing ended/removed. Surface empty — UI shows "no images".
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return [];
    }
    throw err;
  }

  const urls: string[] = [];
  if (res.data.image?.imageUrl) urls.push(res.data.image.imageUrl);
  for (const a of res.data.additionalImages ?? []) {
    if (a.imageUrl && !urls.includes(a.imageUrl)) urls.push(a.imageUrl);
  }

  if (urls.length === 0) return [];

  // 3. Persist. Use createMany with skipDuplicates for idempotency against
  // races (two users opening the same lot simultaneously).
  const rows = urls.map((url, i) => ({
    ebayItemId,
    position: i,
    imageUrl: url,
  }));
  await prisma.lotImage.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return rows.map((r) => ({ position: r.position, imageUrl: r.imageUrl }));
}
