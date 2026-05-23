import axios from "axios";
import { prisma } from "../db.js";
import { config } from "../config.js";

/**
 * Fallback pricing for cards where pokemontcg.io has no `tcgplayer.prices`
 * field — typically alt-art variants (sm11-79a Jirachi-GX SIR, alt-art
 * Charizards, etc.). We resolve the card on TCGPlayer's product search,
 * fetch the product page, and parse the JSON-LD `Product` block.
 *
 * ⚠️ STATUS: currently a no-op. TCGPlayer's website is fully client-rendered
 * (React app shell, no server-rendered HTML — both search and product pages
 * return a ~26KB JS shell with no `<script type="application/ld+json">` and
 * no `<a href="/product/...">` anchors). Static scraping yields nothing.
 *
 * The plumbing (cache table, circuit breaker, resolver hook) is kept so
 * when we add headless rendering (playwright in a worker, or a paid
 * scraping API), turning it back on is a flag flip + DOM-vs-API swap.
 *
 * The default is ENABLE_TCGPLAYER_SCRAPE=false; the resolver falls through
 * to cardmarket prices, which covers the Jirachi-class of alt-art cards.
 *
 * Note: pokemontcg.io exposes a `tcgplayer.url` per card. If/when we have
 * a renderer, we should prefer that URL over our search-based resolution.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScrapedPrices {
  /** Lowest listed price on TCGPlayer. USD. */
  low: number | null;
  /** Highest listed price. USD. */
  high: number | null;
  /**
   * Approximate market price — TCGPlayer's product pages don't always expose
   * a single "market" number, so we use the midpoint of low/high as a proxy
   * when no explicit market is available.
   */
  market: number | null;
  currency: string;
  /** The exact URL we scraped (or attempted). Useful for debugging. */
  productUrl: string | null;
}

export interface ScrapeResult {
  status: "ok" | "not_found" | "scrape_error";
  prices: ScrapedPrices | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h for misses — retry sooner
const SCRAPE_TIMEOUT_MS = 8_000;

/**
 * Circuit breaker: if N consecutive scrapes fail, stop trying for COOLDOWN_MS.
 * Module-level state since the server runs as a single process per Railway
 * replica. If we scale horizontally this needs Redis, but we're not there yet.
 */
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min
let consecutiveFailures = 0;
let cooldownUntil = 0;

const USER_AGENT =
  "Mozilla/5.0 (compatible; TCG-Card-Sniper/1.0; +https://server-production-ad17.up.railway.app)";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get TCGPlayer prices for a card, using a 24h cache. Returns null when
 * scraping is disabled or the circuit breaker is open. Callers should treat
 * a null result the same as "no data" and fall through to the next source.
 *
 * @param pokemonTcgId  — e.g. "sm11-79a"
 * @param cardName      — e.g. "Jirachi-GX"
 * @param setName       — e.g. "Unified Minds"
 * @param cardNumber    — e.g. "79a" — used to disambiguate alt-art variants
 */
export async function scrapeTcgplayerPrices(
  pokemonTcgId: string,
  cardName: string,
  setName: string | null,
  cardNumber: string | null
): Promise<ScrapeResult | null> {
  if (!config.ENABLE_TCGPLAYER_SCRAPE) return null;

  // 1. Check cache (positive or negative — both are useful)
  const cached = await prisma.tcgplayerScrapeCache.findUnique({
    where: { pokemonTcgId },
  });
  if (cached && cached.expiresAt > new Date()) {
    return cacheRowToResult(cached);
  }

  // 2. Circuit breaker
  if (Date.now() < cooldownUntil) {
    console.log(
      `[tcgplayerScrape] circuit open until ${new Date(cooldownUntil).toISOString()}, skipping ${pokemonTcgId}`
    );
    return null;
  }

  // 3. Scrape
  let scraped: ScrapeResult;
  try {
    scraped = await doScrape(cardName, setName, cardNumber);
    consecutiveFailures = 0;
  } catch (err) {
    consecutiveFailures += 1;
    console.error(
      `[tcgplayerScrape] error scraping ${pokemonTcgId} (${cardName} ${cardNumber ?? ""}):`,
      err instanceof Error ? err.message : err
    );
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      console.warn(
        `[tcgplayerScrape] circuit breaker OPEN — ${consecutiveFailures} consecutive failures, cooling down ${COOLDOWN_MS / 60000}m`
      );
    }
    scraped = { status: "scrape_error", prices: null };
  }

  // 4. Persist (positive or negative cache — both reduce repeat work)
  const ttl =
    scraped.status === "ok" ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await prisma.tcgplayerScrapeCache.upsert({
    where: { pokemonTcgId },
    create: {
      pokemonTcgId,
      productUrl: scraped.prices?.productUrl ?? null,
      prices: scraped.prices
        ? {
            low: scraped.prices.low,
            high: scraped.prices.high,
            market: scraped.prices.market,
          }
        : undefined,
      currency: scraped.prices?.currency ?? "USD",
      status: scraped.status,
      fetchedAt: new Date(),
      expiresAt,
    },
    update: {
      productUrl: scraped.prices?.productUrl ?? null,
      prices: scraped.prices
        ? {
            low: scraped.prices.low,
            high: scraped.prices.high,
            market: scraped.prices.market,
          }
        : undefined,
      currency: scraped.prices?.currency ?? "USD",
      status: scraped.status,
      fetchedAt: new Date(),
      expiresAt,
    },
  });

  return scraped;
}

// ─── Cache row ↔ ScrapeResult ─────────────────────────────────────────────────

function cacheRowToResult(row: {
  status: string;
  prices: unknown;
  productUrl: string | null;
  currency: string;
}): ScrapeResult {
  if (row.status !== "ok" || !row.prices) {
    return { status: row.status as ScrapeResult["status"], prices: null };
  }
  const p = row.prices as { low?: number; high?: number; market?: number };
  return {
    status: "ok",
    prices: {
      low: p.low ?? null,
      high: p.high ?? null,
      market: p.market ?? null,
      currency: row.currency,
      productUrl: row.productUrl,
    },
  };
}

// ─── Actual scrape ────────────────────────────────────────────────────────────

/**
 * Resolve the card on TCGPlayer's product search, then fetch the product page
 * and parse JSON-LD. TCGPlayer's search URL is stable:
 *
 *   https://www.tcgplayer.com/search/pokemon/product?q=<query>
 *
 * It returns an HTML page where the top result is the product card. We can
 * extract its href from `<a class="search-result__content" href="/product/123/...">`.
 * Alternatively the search results page has JSON-LD too — we use that.
 *
 * For the query, we use `<cardName> <cardNumber> <setName>` — TCGPlayer's
 * search is fuzzy enough that this usually picks the right product.
 */
async function doScrape(
  cardName: string,
  setName: string | null,
  cardNumber: string | null
): Promise<ScrapeResult> {
  const queryParts = [cardName];
  if (cardNumber) queryParts.push(cardNumber);
  if (setName) queryParts.push(setName);
  const q = encodeURIComponent(queryParts.join(" "));

  const searchUrl = `https://www.tcgplayer.com/search/pokemon/product?q=${q}&view=grid`;

  const searchHtml = await fetchHtml(searchUrl);
  const productPath = extractFirstProductPath(searchHtml);
  if (!productPath) {
    return { status: "not_found", prices: null };
  }

  const productUrl = productPath.startsWith("http")
    ? productPath
    : `https://www.tcgplayer.com${productPath}`;

  const productHtml = await fetchHtml(productUrl);
  const prices = extractPricesFromJsonLd(productHtml, productUrl);

  if (!prices) return { status: "not_found", prices: null };
  return { status: "ok", prices };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await axios.get<string>(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: SCRAPE_TIMEOUT_MS,
    responseType: "text",
    // 404 from TCGPlayer just means no product — let the parser decide.
    validateStatus: (s) => s < 500,
  });
  return res.data;
}

/**
 * Find the first `/product/<id>/...` link in a TCGPlayer search results HTML
 * page. We use a regex rather than a DOM parser to keep things cheap.
 */
function extractFirstProductPath(html: string): string | null {
  const match = html.match(/href="(\/product\/\d+\/[^"']+)"/);
  return match ? match[1] : null;
}

/**
 * Pull the JSON-LD `Product` block out of a TCGPlayer product page and
 * extract the `offers.lowPrice` / `offers.highPrice` / `offers.priceCurrency`.
 * TCGPlayer also includes an aggregate `offers.price` field on some pages.
 */
function extractPricesFromJsonLd(
  html: string,
  productUrl: string
): ScrapedPrices | null {
  const blocks = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const m of blocks) {
    const raw = m[1].trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const obj of arr) {
      if (
        typeof obj !== "object" ||
        obj === null ||
        (obj as { ["@type"]?: string })["@type"] !== "Product"
      ) {
        continue;
      }
      const offers = (obj as { offers?: unknown }).offers;
      if (typeof offers !== "object" || offers === null) continue;
      const o = offers as {
        lowPrice?: number | string;
        highPrice?: number | string;
        price?: number | string;
        priceCurrency?: string;
      };
      const low = toNumber(o.lowPrice);
      const high = toNumber(o.highPrice);
      const single = toNumber(o.price);
      const currency = o.priceCurrency ?? "USD";

      // Market = either the explicit `price`, or the midpoint of low/high.
      const market =
        single ?? (low != null && high != null ? (low + high) / 2 : low ?? high);

      if (low == null && high == null && single == null) continue;

      return { low, high, market, currency, productUrl };
    }
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
