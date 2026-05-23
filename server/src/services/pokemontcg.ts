import axios from "axios";

const BASE_URL = "https://api.pokemontcg.io/v2";

// ─── Public response shapes ───────────────────────────────────────────────────

/** TCGPlayer price tier — every variant has these four fields */
export interface VariantPrices {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  directLow: number | null;
}

/** Map of variant name → its TCGPlayer prices. Variant keys are pokemontcg.io's
 *  raw names: normal, holofoil, reverseHolofoil, 1stEdition, 1stEditionHolofoil,
 *  unlimited, unlimitedHolofoil, etc. The exact set varies per card. */
export type VariantPriceMap = Record<string, VariantPrices>;

/**
 * Cardmarket aggregate prices. pokemontcg.io returns a *single* flat object
 * per card (not per-variant), so we expose the most useful fields directly.
 * All values are EUR. `trendPrice` is the best "current market" approximation;
 * `averageSellPrice` is more conservative.
 */
export interface CardmarketPrices {
  averageSellPrice: number | null;
  lowPrice: number | null;
  trendPrice: number | null;
  /** Reverse-holo variant aggregates, when applicable. */
  reverseHoloTrend: number | null;
  reverseHoloSell: number | null;
}

export interface CatalogCard {
  id: string;            // e.g. "base1-4"
  name: string;          // e.g. "Charizard"
  number: string;        // e.g. "4"
  rarity: string | null;
  setId: string;
  setName: string;
  setSeries: string;
  imageSmall: string | null;
  imageLarge: string | null;
  /** Available variants (keys of the variants map) — empty array if no TCGPlayer data */
  variants: string[];
  /** Full TCGPlayer prices keyed by variant. Empty object when TCGPlayer data
   *  is absent from pokemontcg.io for this card. */
  variantPrices: VariantPriceMap;
  /** Cardmarket aggregate prices (EUR), null when not present. Useful as a
   *  fallback for cards pokemontcg.io has no TCGPlayer data for — typically
   *  alt-arts like sm11-79a (Jirachi-GX). */
  cardmarketPrices: CardmarketPrices | null;
  /** Convenience: market price of the first available variant, for thumbnail rendering */
  previewMarket: number | null;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface RawCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: {
    id: string;
    name: string;
    series: string;
  };
  images?: {
    small?: string;
    large?: string;
  };
  tcgplayer?: {
    prices?: VariantPriceMap;
  };
  cardmarket?: {
    prices?: {
      averageSellPrice?: number;
      lowPrice?: number;
      trendPrice?: number;
      reverseHoloSell?: number;
      reverseHoloTrend?: number;
      [key: string]: number | undefined;
    };
  };
}

interface SearchResponse {
  data: RawCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

interface SingleResponse {
  data: RawCard;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalise(card: RawCard): CatalogCard {
  const variantPrices = card.tcgplayer?.prices ?? {};
  const variants = Object.keys(variantPrices);
  const firstVariant = variants[0];

  const cm = card.cardmarket?.prices;
  const cardmarketPrices: CardmarketPrices | null = cm
    ? {
        averageSellPrice: cm.averageSellPrice ?? null,
        lowPrice: cm.lowPrice ?? null,
        trendPrice: cm.trendPrice ?? null,
        reverseHoloTrend: cm.reverseHoloTrend ?? null,
        reverseHoloSell: cm.reverseHoloSell ?? null,
      }
    : null;

  // previewMarket prefers TCGPlayer (USD); falls back to cardmarket trend (EUR)
  // so thumbnails for alt-art cards aren't blank. Currency mismatch is fine
  // for a thumbnail-level "rough price" hint; precise scoring uses the right
  // source + currency via priceVariant.ts.
  const previewMarket =
    (firstVariant ? variantPrices[firstVariant]?.market ?? null : null) ??
    cardmarketPrices?.trendPrice ??
    cardmarketPrices?.averageSellPrice ??
    null;

  return {
    id: card.id,
    name: card.name,
    number: card.number,
    rarity: card.rarity ?? null,
    setId: card.set.id,
    setName: card.set.name,
    setSeries: card.set.series,
    imageSmall: card.images?.small ?? null,
    imageLarge: card.images?.large ?? null,
    variants,
    variantPrices,
    cardmarketPrices,
    previewMarket,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search the pokemontcg.io catalog. Queries against the `name` field with a
 * wildcard so partial matches surface (e.g. "char" → Charizard, Charmander).
 * Falls back to a free-text search if the wildcard form returns nothing.
 *
 * No API key is required for low-volume reads on the public endpoint.
 */
/**
 * Known *subsets* — small named groupings inside a parent set that share a
 * card-number prefix. pokemontcg.io has no first-class "subset" field, so
 * we recognise them by query and translate to `set.id:<parent> AND number:<prefix>*`.
 *
 * Add to this map as more subsets surface in user feedback (Trainer Gallery,
 * Shiny Vault, Galarian Gallery, Hidden Fates Shiny Vault, etc.).
 */
const SUBSET_ALIASES: Array<{
  /** Match the search query (lowercased) against this regex. */
  match: RegExp;
  /** pokemontcg.io set IDs the subset lives in. */
  setIds: string[];
  /** Card-number prefix that identifies subset members. */
  numberPrefix: string;
}> = [
  // "Radiant Collection" — the same RC*-numbered subset appears in two
  // parent sets: BW Legendary Treasures (bw11, RC1–RC25, 2013) and XY
  // Generations (g1, RC1–RC32, 2016). Together = 57 cards. We include both
  // so a search for "Radiant Collection" surfaces the entire collection,
  // not just the newer Generations half.
  { match: /\bradiant\s*collection\b/i, setIds: ["bw11", "g1"], numberPrefix: "RC" },
  // SWSH-era Trainer Gallery cards — TG-prefixed numbers across several sets.
  { match: /\btrainer\s*gallery\b/i, setIds: [], numberPrefix: "TG" },
  // SWSH Crown Zenith — Galarian Gallery subset, GG-prefixed.
  { match: /\bgalarian\s*gallery\b/i, setIds: ["swsh12pt5gg"], numberPrefix: "GG" },
  // Hidden Fates Shiny Vault (SV-prefixed inside sm115).
  { match: /\bshiny\s*vault\b/i, setIds: ["sm115"], numberPrefix: "SV" },
];

/**
 * Try to interpret the query as a known subset. Returns a Lucene clause or
 * null when the query doesn't match any subset alias.
 */
// Exported for unit tests; not used outside searchCatalogRemote in production.
export function subsetQuery(query: string): string | null {
  for (const sub of SUBSET_ALIASES) {
    if (!sub.match.test(query)) continue;
    const numberClause = `number:${sub.numberPrefix}*`;
    if (sub.setIds.length === 0) return numberClause;
    const setClause = `(${sub.setIds.map((id) => `set.id:${id}`).join(" OR ")})`;
    return `${setClause} AND ${numberClause}`;
  }
  return null;
}

/**
 * Public catalog search entry point. Tries the local Postgres cache first
 * (fast, single-digit ms) and only falls back to the remote pokemontcg.io
 * API if the cache is cold (first deploy, before sync ran).
 *
 * This is the function the rest of the app should use. `searchCatalogRemote`
 * is exported below for the sync job and any direct callers, but everyday
 * search traffic should never hit the remote.
 */
export async function searchCatalog(
  query: string,
  pageSize = 20
): Promise<CatalogCard[]> {
  // Lazy import to avoid a circular-dep edge if Prisma client setup imports
  // from this file before db.ts is ready.
  const { searchLocalCatalog } = await import("./localCatalog.js");
  const local = await searchLocalCatalog(query, pageSize);
  if (local !== null) return local;

  // Cold cache → fall back to remote so the app still works pre-sync.
  console.warn("[catalog] local cache empty, falling back to remote search");
  return searchCatalogRemote(query, pageSize);
}

export async function searchCatalogRemote(
  query: string,
  pageSize = 20
): Promise<CatalogCard[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // pokemontcg.io uses Lucene. We run several query forms in parallel and
  // merge with precedence:
  //
  //   1. subset alias        — "radiant collection" → g1 + number:RC*
  //   2. name exact phrase   — `name:"Sylveon EX"`, won't match "Mewtwo"
  //   3. token AND           — `name:Sylveon* AND name:EX*`, bridges
  //      "Sylveon-EX" vs "Sylveon ex" naming conventions across eras
  //   4. set name prefix     — `set.name:"Generations*"`, lets users browse
  //      cards by set ("Generations", "Prismatic Evolutions")
  //   5. name prefix-on-phrase — `name:"char*"` typeahead style
  //
  // Dedupe by card id, preserving the precedence order.
  const safe = trimmed.replace(/"/g, "");
  const tokens = safe.split(/[\s-]+/).filter((t) => t.length > 0);

  const subsetQ = subsetQuery(safe);
  const exactQ = `name:"${safe}"`;
  const tokenQ =
    tokens.length > 1
      ? tokens.map((t) => `name:${t}*`).join(" AND ")
      : null;
  const setNameQ = `set.name:"${safe}*"`;
  const prefixQ = `name:"${safe}*"`;

  const commonParams = {
    pageSize,
    orderBy: "-set.releaseDate",
    select: "id,name,number,rarity,set,images,tcgplayer,cardmarket",
  };

  // Subset queries return their own page of results (up to pageSize); the
  // others share the rest of the budget. We still issue them all in parallel.
  const queries = [
    ...(subsetQ ? [subsetQ] : []),
    exactQ,
    ...(tokenQ ? [tokenQ] : []),
    setNameQ,
    prefixQ,
  ];

  const responses = await Promise.all(
    queries.map((q) =>
      axios.get<SearchResponse>(`${BASE_URL}/cards`, {
        params: { ...commonParams, q },
        timeout: 8000,
      })
    )
  );

  const seen = new Set<string>();
  const merged: RawCard[] = [];
  for (const res of responses) {
    for (const card of res.data.data) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      merged.push(card);
      if (merged.length >= pageSize) break;
    }
    if (merged.length >= pageSize) break;
  }

  return merged.map(normalise);
}

/**
 * Fetch a single card by its pokemontcg.io ID (e.g. "base1-4").
 * Used to refresh price data without going through search.
 */
export async function fetchCardById(id: string): Promise<CatalogCard | null> {
  try {
    const response = await axios.get<SingleResponse>(`${BASE_URL}/cards/${id}`, {
      params: {
        select: "id,name,number,rarity,set,images,tcgplayer,cardmarket",
      },
      timeout: 8000,
    });
    return normalise(response.data.data);
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}
