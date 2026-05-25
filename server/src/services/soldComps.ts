import * as cheerio from "cheerio";
import { prisma } from "../db.js";
import { config } from "../config.js";

/**
 * C1 — Sold-comps fetcher.
 *
 * Uses eBay's Finding API (`findCompletedItems` + `SoldItemsOnly`) to
 * pull recently-sold listings for a keyword query. Results land in the
 * `SoldComp` table keyed by (query, ebayItemId) so a re-fetch of the
 * same query is mostly a DB read.
 *
 * Why Finding API: the modern Browse API only returns ACTIVE listings.
 * The Marketplace Insights API has the sold data we want but requires
 * eBay business approval. The Finding API is deprecated (still alive,
 * uses the same client ID as Browse) and works for the vast majority of
 * sold-comp use cases — same data source that 130point/PriceCharting
 * reach via similar paths. Direct page scraping is unreliable because
 * eBay aggressively blocks datacenter IPs.
 *
 * Politeness: results are cached for `SOLD_COMP_TTL_HOURS` (default 24h)
 * so a user opening the same drawer twice is one HTTP call.
 */

const FINDING_API_URL = "https://svcs.ebay.com/services/search/FindingService/v1";
const SCRAPINGBEE_URL = "https://app.scrapingbee.com/api/v1/";
const EBAY_SOLD_URL = "https://www.ebay.com/sch/i.html";
const SOLD_COMP_TTL_HOURS = 24;

export interface SoldCompRow {
  ebayItemId: string;
  title: string;
  soldPrice: number;
  shippingCost: number | null;
  totalPrice: number;
  conditionGrade: string | null;
  acceptedOffer: boolean;
  soldAt: Date;
  imageUrl: string | null;
  ebayUrl: string;
}

export interface SoldCompSummary {
  count: number;
  /** Median totalPrice across all comps. */
  median: number | null;
  /** Lowest totalPrice. */
  low: number | null;
  /** Highest totalPrice. */
  high: number | null;
  /** ISO date of the most recent sale. */
  mostRecentAt: string | null;
}

/**
 * Map eBay's free-text condition strings ("Pre-Owned", "Brand New", "PSA 9",
 * "Like New") into the canonical NM/LP/MP/HP/DMG/GRADED keys the rest of the
 * app uses. Returns null for unrecognised values rather than guessing.
 */
export function normaliseCondition(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/psa|bgs|cgc|ace|graded|gem mint|gma/.test(t)) return "GRADED";
  if (/brand new|new \(other\)|mint/.test(t)) return "NM";
  if (/like new|near mint|nm/.test(t)) return "NM";
  if (/excellent|lightly played|lp/.test(t)) return "LP";
  if (/very good|moderately played|mp/.test(t)) return "MP";
  if (/good|heavily played|hp/.test(t)) return "HP";
  if (/acceptable|damaged|dmg|poor/.test(t)) return "DMG";
  if (/pre-owned|used/.test(t)) return null; // too vague
  return null;
}

/**
 * Fetch + parse the eBay sold listings page for a query. Returns the raw
 * row list — caller is responsible for persistence + dedup.
 */
/**
 * Defensive accessor for the deeply-nested Finding API response shape.
 * Every leaf in the JSON is wrapped in a 1-element array — `["foo"]` for
 * scalars, `[{...}]` for objects. Returns undefined for any missing step.
 */
function fa<T>(node: unknown, ...path: (string | number)[]): T | undefined {
  let cur: unknown = node;
  for (const key of path) {
    if (cur == null) return undefined;
    if (typeof key === "number" && Array.isArray(cur)) cur = cur[key];
    else if (typeof key === "string" && typeof cur === "object")
      cur = (cur as Record<string, unknown>)[key];
    else return undefined;
  }
  return cur as T | undefined;
}

interface FindingItem {
  itemId?: string[];
  title?: string[];
  viewItemURL?: string[];
  galleryURL?: string[];
  sellingStatus?: Array<{
    currentPrice?: Array<{ "@currencyId"?: string; __value__?: string }>;
    convertedCurrentPrice?: Array<{ "@currencyId"?: string; __value__?: string }>;
    sellingState?: string[];
  }>;
  shippingInfo?: Array<{
    shippingServiceCost?: Array<{ "@currencyId"?: string; __value__?: string }>;
    shippingType?: string[];
  }>;
  condition?: Array<{ conditionDisplayName?: string[] }>;
  listingInfo?: Array<{
    endTime?: string[];
    bestOfferEnabled?: string[];
    listingType?: string[];
  }>;
}

/**
 * Map a single Finding API `item` node into our SoldCompRow shape. Returns
 * null when required fields are missing. Exported for tests.
 */
export function mapFindingItem(item: FindingItem): SoldCompRow | null {
  const ebayItemId = fa<string>(item, "itemId", 0);
  const title = fa<string>(item, "title", 0);
  const viewUrl = fa<string>(item, "viewItemURL", 0) ?? "";
  const priceStr =
    fa<string>(item, "sellingStatus", 0, "convertedCurrentPrice", 0, "__value__") ??
    fa<string>(item, "sellingStatus", 0, "currentPrice", 0, "__value__");
  const shippingStr = fa<string>(
    item,
    "shippingInfo",
    0,
    "shippingServiceCost",
    0,
    "__value__"
  );
  const shippingType = fa<string>(item, "shippingInfo", 0, "shippingType", 0);
  const conditionText = fa<string>(item, "condition", 0, "conditionDisplayName", 0);
  const endTimeStr = fa<string>(item, "listingInfo", 0, "endTime", 0);
  const imageUrl = fa<string>(item, "galleryURL", 0) ?? null;

  if (!ebayItemId || !title || priceStr == null) return null;
  const soldPrice = parseFloat(priceStr);
  if (!Number.isFinite(soldPrice) || soldPrice <= 0) return null;

  const shippingCost =
    shippingType && /free/i.test(shippingType)
      ? 0
      : shippingStr != null
        ? parseFloat(shippingStr)
        : null;
  const soldAt = endTimeStr ? new Date(endTimeStr) : new Date();

  return {
    ebayItemId,
    title,
    soldPrice,
    shippingCost: Number.isFinite(shippingCost as number) ? shippingCost : null,
    totalPrice: soldPrice + (Number.isFinite(shippingCost as number) ? (shippingCost as number) : 0),
    conditionGrade: normaliseCondition(conditionText),
    // Finding API doesn't expose "best offer accepted" reliably; v1 leaves
    // this false. Future: cross-ref against bidCount + bestOfferEnabled if
    // we want a heuristic.
    acceptedOffer: false,
    soldAt: Number.isNaN(soldAt.getTime()) ? new Date() : soldAt,
    imageUrl,
    ebayUrl: viewUrl || `https://www.ebay.com/itm/${ebayItemId}`,
  };
}

/**
 * Parse a sold-listings HTML page (current eBay structure: <li class="s-card">
 * with su-styled-text descendants for title/price). Exported for tests and
 * for the ScrapingBee fallback path.
 */
export function parseSoldListingsHtml(html: string): SoldCompRow[] {
  const $ = cheerio.load(html);
  const rows: SoldCompRow[] = [];
  const seen = new Set<string>();

  $("li[data-listingid]").each((_, el) => {
    const $el = $(el);
    const ebayItemId = $el.attr("data-listingid")?.trim();
    if (!ebayItemId || seen.has(ebayItemId)) return;

    const url = $el.find("a.s-card__link").attr("href") ?? "";
    // eBay's rendered DOM sometimes prepends an 8-digit numeric tracking ID
    // to the visible title text. Strip it.
    const rawTitle = $el.find(".s-card__title, .su-styled-text--primary").first().text().trim();
    const titleText = rawTitle.replace(/^\d{6,}\s+/, "").trim();
    if (!titleText || /shop on ebay/i.test(titleText)) return;

    // Price node — usually the first .s-card__price or a su-styled-text with
    // a "$" prefix. Fall back to any text node beginning with $.
    let priceText =
      $el.find(".s-card__price").first().text().trim() ||
      $el
        .find("span.su-styled-text")
        .filter((_, n) => /^\s*\$/.test($(n).text()))
        .first()
        .text()
        .trim();
    if (!priceText) return;
    const priceMatch = priceText.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
    if (!priceMatch) return;
    const soldPrice = parseFloat(priceMatch[1]);
    if (!Number.isFinite(soldPrice) || soldPrice <= 0) return;

    const shipText = $el.find(".s-card__shipping, .s-card__caption").text();
    let shippingCost: number | null = null;
    if (/free shipping/i.test(shipText)) shippingCost = 0;
    else {
      const shipMatch = shipText.replace(/,/g, "").match(/\$\s*(\d+(?:\.\d+)?)/);
      if (shipMatch) shippingCost = parseFloat(shipMatch[1]);
    }

    const conditionText = $el
      .find(".s-card__subtitle, .SECONDARY_INFO")
      .first()
      .text()
      .trim();

    const acceptedOffer = /best offer accepted/i.test($el.text());

    const imageUrl =
      $el.find(".su-media-container img").first().attr("src") ??
      $el.find(".s-card__image img").first().attr("src") ??
      null;

    seen.add(ebayItemId);
    rows.push({
      ebayItemId,
      title: titleText,
      soldPrice,
      shippingCost,
      totalPrice: soldPrice + (shippingCost ?? 0),
      conditionGrade: normaliseCondition(conditionText),
      acceptedOffer,
      // eBay's sold page doesn't always include a per-card sold date in
      // markup. Default to now() — within the 90-day window we surface.
      soldAt: new Date(),
      imageUrl,
      ebayUrl: `https://www.ebay.com/itm/${ebayItemId}`,
    });
  });

  return rows;
}

/** Fetch a URL through ScrapingBee (residential proxy + handles bot pages). */
async function fetchViaScrapingBee(target: string): Promise<string> {
  const key = config.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error("SCRAPINGBEE_API_KEY not set");
  const url = new URL(SCRAPINGBEE_URL);
  url.searchParams.set("api_key", key);
  url.searchParams.set("url", target);
  // eBay returns 613 to ScrapingBee unless JS rendering is on — render_js
  // bumps cost from 5 → 25 credits, so the free 1000 credits/month is good
  // for ~40 sold-comp fetches. The 24h DB cache keeps that count low.
  url.searchParams.set("render_js", "true");
  url.searchParams.set("premium_proxy", "true");
  url.searchParams.set("country_code", "us");

  const r = await fetch(url.toString());
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`ScrapingBee ${r.status}: ${body.slice(0, 200)}`);
  }
  return r.text();
}

export async function fetchSoldComps(query: string): Promise<SoldCompRow[]> {
  // Preferred path: ScrapingBee (handles bot detection + residential IP).
  // The Finding API path is kept as a fallback for environments where the
  // SCRAPINGBEE key is intentionally absent, but it is rate-limited to near
  // zero for unapproved apps so it is best-effort only.
  if (config.SCRAPINGBEE_API_KEY) {
    const target = new URL(EBAY_SOLD_URL);
    target.searchParams.set("_nkw", query);
    target.searchParams.set("LH_Sold", "1");
    target.searchParams.set("LH_Complete", "1");
    target.searchParams.set("_ipg", "60");
    const html = await fetchViaScrapingBee(target.toString());
    return parseSoldListingsHtml(html);
  }

  const appId = config.EBAY_CLIENT_ID;
  const url = new URL(FINDING_API_URL);
  url.searchParams.set("OPERATION-NAME", "findCompletedItems");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", appId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "");
  url.searchParams.set("keywords", query);
  url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
  url.searchParams.set("itemFilter(0).value", "true");
  url.searchParams.set("paginationInput.entriesPerPage", "100");
  url.searchParams.set("sortOrder", "EndTimeSoonest");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    throw new Error(
      `eBay Finding API failed: ${resp.status} ${resp.statusText}`
    );
  }
  const json: unknown = await resp.json();

  // The response shape is documented at:
  // https://developer.ebay.com/devzone/finding/CallRef/findCompletedItems.html
  // Top-level shape: { findCompletedItemsResponse: [{ searchResult: [{ item: [...] }] }] }
  const ack = fa<string>(
    json,
    "findCompletedItemsResponse",
    0,
    "ack",
    0
  );
  if (ack && ack !== "Success" && ack !== "Warning") {
    const errMsg =
      fa<string>(
        json,
        "findCompletedItemsResponse",
        0,
        "errorMessage",
        0,
        "error",
        0,
        "message",
        0
      ) ?? `ack=${ack}`;
    throw new Error(`eBay Finding API error: ${errMsg}`);
  }

  const items =
    fa<FindingItem[]>(
      json,
      "findCompletedItemsResponse",
      0,
      "searchResult",
      0,
      "item"
    ) ?? [];

  const rows: SoldCompRow[] = [];
  for (const it of items) {
    const row = mapFindingItem(it);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Cache-aware fetch: returns rows from DB when the query was fetched
 * within the TTL, otherwise scrapes eBay and upserts. Returns the full
 * row set including any older comps that are still within the rolling
 * 90-day window.
 */
export async function getSoldComps(
  query: string,
  opts: { cardId?: string | null; ttlHours?: number } = {}
): Promise<{ rows: SoldCompRow[]; fromCache: boolean }> {
  const ttlHours = opts.ttlHours ?? SOLD_COMP_TTL_HOURS;
  const cutoff = new Date(Date.now() - ttlHours * 60 * 60 * 1000);

  // If we have ANY rows for this query newer than the TTL cutoff, treat as warm.
  const recentCount = await prisma.soldComp.count({
    where: { query, fetchedAt: { gt: cutoff } },
  });

  let fromCache = recentCount > 0;
  if (!fromCache) {
    try {
      const fresh = await fetchSoldComps(query);
      if (fresh.length > 0) {
        await Promise.all(
          fresh.map((r) =>
            prisma.soldComp.upsert({
              where: {
                query_ebayItemId: { query, ebayItemId: r.ebayItemId },
              },
              create: {
                query,
                cardId: opts.cardId ?? null,
                ebayItemId: r.ebayItemId,
                title: r.title,
                soldPrice: r.soldPrice,
                shippingCost: r.shippingCost ?? null,
                totalPrice: r.totalPrice,
                conditionGrade: r.conditionGrade ?? null,
                acceptedOffer: r.acceptedOffer,
                soldAt: r.soldAt,
                imageUrl: r.imageUrl ?? null,
                ebayUrl: r.ebayUrl,
              },
              update: {
                cardId: opts.cardId ?? undefined,
                title: r.title,
                soldPrice: r.soldPrice,
                shippingCost: r.shippingCost ?? null,
                totalPrice: r.totalPrice,
                conditionGrade: r.conditionGrade ?? null,
                acceptedOffer: r.acceptedOffer,
                soldAt: r.soldAt,
                imageUrl: r.imageUrl ?? null,
                ebayUrl: r.ebayUrl,
                fetchedAt: new Date(),
              },
            })
          )
        );
      } else {
        console.warn(`[soldComps] no rows parsed for query "${query}"`);
      }
    } catch (err) {
      console.error(
        `[soldComps] fetch failed for "${query}":`,
        err instanceof Error ? err.message : err
      );
      // Fall through — return whatever stale rows we have.
    }
  }

  // Return all comps for this query within the last 90 days regardless of
  // fetch cycle — the summary view spans a window, not a single scrape.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const all = await prisma.soldComp.findMany({
    where: { query, soldAt: { gt: ninetyDaysAgo } },
    orderBy: { soldAt: "desc" },
  });

  return {
    rows: all.map((r) => ({
      ebayItemId: r.ebayItemId,
      title: r.title,
      soldPrice: Number(r.soldPrice),
      shippingCost: r.shippingCost != null ? Number(r.shippingCost) : null,
      totalPrice: Number(r.totalPrice),
      conditionGrade: r.conditionGrade,
      acceptedOffer: r.acceptedOffer,
      soldAt: r.soldAt,
      imageUrl: r.imageUrl,
      ebayUrl: r.ebayUrl,
    })),
    fromCache,
  };
}

/** Compute median/low/high/count summary from a SoldCompRow[]. */
export function summariseSoldComps(rows: SoldCompRow[]): SoldCompSummary {
  if (rows.length === 0) {
    return { count: 0, median: null, low: null, high: null, mostRecentAt: null };
  }
  const prices = rows.map((r) => r.totalPrice).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];
  const mostRecentAt = rows
    .map((r) => r.soldAt)
    .reduce((a, b) => (a > b ? a : b))
    .toISOString();
  return {
    count: rows.length,
    median: Number(median.toFixed(2)),
    low: prices[0],
    high: prices[prices.length - 1],
    mostRecentAt,
  };
}
