import axios from "axios";
import { config, EBAY_BASE_URL, EBAY_POKEMON_CATEGORY_ID } from "../config.js";
import { containsFuzzy, noiseTermVariants } from "./misspellings.js";

// ─── OAuth token cache ────────────────────────────────────────────────────────

interface EbayToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

let tokenCache: EbayToken | null = null;

/**
 * Fetch (or return a cached) eBay application token via the
 * OAuth 2.0 Client Credentials flow.
 *
 * Tokens are valid for 7200 seconds (2 hours). We refresh 5 minutes
 * early to avoid races at expiry boundaries.
 */
async function getEbayToken(): Promise<string> {
  const now = Date.now();
  const BUFFER_MS = 5 * 60 * 1000; // 5 min

  if (tokenCache && tokenCache.expiresAt - BUFFER_MS > now) {
    return tokenCache.accessToken;
  }

  const credentials = Buffer.from(
    `${config.EBAY_CLIENT_ID}:${config.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.post<{ access_token: string; expires_in: number }>(
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
    accessToken: response.data.access_token,
    expiresAt: now + response.data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

// ─── Browse API types ─────────────────────────────────────────────────────────

export interface EbayListingRaw {
  itemId: string;
  title: string;
  /// Buy It Now price. Absent on pure-auction listings (those have only
  /// currentBidPrice). We tolerate the absence and fall back below.
  price?: { value: string; currency: string };
  shippingOptions?: Array<{
    shippingCost?: { value: string; currency: string };
    shippingCostType?: string; // "FIXED" | "FREE" | "CALCULATED"
  }>;
  buyingOptions: string[]; // ["AUCTION"] | ["FIXED_PRICE"] | ["AUCTION", "FIXED_PRICE"]
  itemAffiliateWebUrl?: string;
  itemWebUrl: string;
  condition?: string;
  seller?: { username: string; feedbackPercentage: string };
  currentBidPrice?: { value: string; currency: string };
  bidCount?: number;
  itemEndDate?: string; // ISO 8601
  thumbnailImages?: Array<{ imageUrl: string }>;
}

interface SearchResponse {
  itemSummaries?: EbayListingRaw[];
  total?: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Card condition grade parsed from the listing title. Falls back to UNKNOWN
 * when nothing matches — those listings are scored against full market (i.e.
 * we assume NM, since most untagged listings are claimed NM-ish).
 *
 * GRADED_* values cover slabbed cards: PSA 8 ~ NM, PSA 9 = premium, PSA 10 =
 * big premium. We track them so we can later apply the right multiplier per
 * grade — for now PSA 9/10 use a single GRADED bucket scored at full market
 * (slabbed cards sell for *more*, but our deal floor still flags real bargains).
 */
export type ConditionGrade =
  | "NM"
  | "LP"
  | "MP"
  | "HP"
  | "DMG"
  | "GRADED"
  | "UNKNOWN";

/** More precise shape than ListingType. Mirrors Prisma's ListingKind enum. */
export type ListingKind = "AUCTION_ONLY" | "BIN" | "BIN_PLUS_AUCTION";

export interface NormalisedListing {
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  /**
   * The reference price for scoring. For BIN/BIN_PLUS_AUCTION it's the
   * Buy-It-Now price. For AUCTION_ONLY it's the current bid (which can rise
   * before the auction ends — the score on file is a snapshot at fetch time).
   */
  listingPrice: number;
  /** null = free shipping */
  shippingCost: number | null;
  /** listingPrice + (shippingCost ?? 0) */
  totalCost: number;
  /** Legacy "is this an auction at all?" boolean — kept for back-compat. */
  listingType: "AUCTION" | "FIXED_PRICE";
  /** Precise shape; new in P5. */
  kind: ListingKind;
  condition: string | null;
  /** Parsed condition grade — drives the market-price multiplier. */
  conditionGrade: ConditionGrade;
  seller: string | null;
  sellerFeedback: number | null;
  bids: number | null;
  endTime: Date | null;
}

/**
 * Inspect a listing title for condition tokens and return the parsed grade.
 *
 * Matching order matters: we check the most specific phrases first
 * ("near mint" before "mint", "moderately played" before "mp") so a title
 * like "Sylveon EX MP" doesn't accidentally win on the "mint" substring
 * inside "Mint Pokemon" gibberish.
 *
 * Tokens are matched with surrounding word boundaries to avoid the classic
 * "MP" matching inside "MPS" or "tcgmp123" etc.
 */
export function parseConditionFromTitle(title: string): ConditionGrade {
  const t = ` ${title.toLowerCase()} `;
  // Accept the condition token as standalone (` nm `), parenthesised (`(nm)`),
  // comma/period-terminated, OR slash-separated (`nm/m`, `lp/nm`) which is a
  // common eBay seller shorthand for "between two grades."
  const has = (needle: string) =>
    t.includes(` ${needle} `) ||
    t.includes(`(${needle})`) ||
    t.includes(` ${needle},`) ||
    t.includes(` ${needle}.`) ||
    t.includes(` ${needle}/`) ||
    t.includes(`/${needle} `) ||
    t.includes(`/${needle}/`);

  // Graded slabs (PSA / BGS / CGC / SGC). The presence of any grading-house
  // abbreviation with a number is enough — exact grade parsing comes later.
  if (/\b(psa|bgs|cgc|sgc|tag|ace)\s*\d+(\.\d+)?\b/i.test(title)) return "GRADED";

  // Damaged
  if (has("dmg") || has("damaged") || has("dam")) return "DMG";
  // Heavily played
  if (has("hp") || /heavily\s*played/i.test(title)) return "HP";
  // Moderately played
  if (has("mp") || /moderately\s*played/i.test(title)) return "MP";
  // Lightly played
  if (has("lp") || /lightly\s*played/i.test(title)) return "LP";
  // Near mint / Mint
  if (has("nm") || /near\s*mint/i.test(title) || /\bmint\b/i.test(title)) return "NM";

  return "UNKNOWN";
}

/**
 * Market-price multiplier for each condition grade. Applied to the NM
 * TCGPlayer market price to get the *expected* sell price at that condition.
 *
 * Values mirror TCGPlayer's published condition-adjusted prices for the
 * Pokémon TCG market. UNKNOWN defaults to NM because most untagged listings
 * are sellers leaving condition implicit, not signalling damage.
 */
export const CONDITION_MULTIPLIER: Record<ConditionGrade, number> = {
  NM: 1.0,
  LP: 0.85,
  MP: 0.65,
  HP: 0.4,
  DMG: 0.25,
  // Graded cards trade at a premium to raw NM. PSA 9 is ~1.5×, PSA 10 ~3×.
  // We use the conservative end so HOT-flagging stays accurate — a graded
  // listing below raw NM is unambiguously a deal.
  GRADED: 1.5,
  UNKNOWN: 1.0,
};

/**
 * Search eBay for listings of a specific Pokémon card.
 *
 * Search strategy is two-stage:
 *   1. eBay query: `"<cardName>" <condition>` — quoted name forces phrase match
 *      so "Mewtwo ex" doesn't bleed into listings that just contain "Mewtwo".
 *      We *don't* include the card number in the eBay query: it's too strict.
 *      Many sellers write "25/25" or just omit it, and we'd lose real hits.
 *   2. Post-filter the returned listings by title — keep only those whose
 *      title contains the full card name (case-insensitive). This is where
 *      precision actually comes from. Optionally we boost listings that ALSO
 *      mention the card number, but we don't require it.
 *
 * Result: high recall from eBay, high precision from our own title check.
 *
 * @param cardName   - e.g. "Charizard ex"
 * @param cardNumber - e.g. "4" or "240/182" — used for ranking/filtering only
 * @param condition  - optional variant qualifier (e.g. "holo", "reverse holo")
 * @param limit      - max results to return (eBay max 200)
 */
export async function searchEbayListings(
  cardName: string,
  cardNumber?: string | null,
  condition?: string,
  setName?: string | null,
  limit = 20
): Promise<NormalisedListing[]> {
  const token = await getEbayToken();

  // Quote the name so eBay treats it as a phrase. Include the card number
  // when we have one — eBay's ranking heavily uses numbers ("25", "232/091")
  // to surface the specific printing instead of just the top-volume one.
  //
  // We intentionally do NOT add the variant condition ("holo", "reverse holo")
  // to the eBay query. Many high-value modern printings — Paldean Fates SIRs,
  // alt arts, illustration rares — are categorised as `holofoil` by
  // pokemontcg.io, but sellers list them as "SIR" / "Special Illustration Rare"
  // / "Alt Art" — never "holo". Including "holo" excludes those listings
  // entirely. The variant still drives which market price we compare against;
  // precision comes from the title filter (name + number/set) and the
  // Pokemon TCG category restriction.
  //
  // We over-fetch (3x limit) so the post-filter can still discard mismatches.
  void condition;
  const cleanName = cardName.replace(/"/g, "").trim();
  const parts = [`"${cleanName}"`];
  if (cardNumber) parts.push(cardNumber);
  const canonicalQuery = parts.join(" ");

  // Over-fetch generously: for popular cards (Charizard, Mew) the first
  // page of relevance-ranked listings is dominated by accessories. Going
  // deep helps the actual-card listings surface after filtering.
  const fetchLimit = Math.min(Math.max(limit * 10, 100), 200);

  // Pa: parallel-fan-out across noise-term variants. The canonical query
  // covers the common case; the variants surface listings whose sellers
  // typed "pokimon" / "holographik" / "mnt" etc. Each variant is an extra
  // ~500ms HTTP call; bounded to 3 by `noiseTermVariants`.
  const variants = noiseTermVariants(canonicalQuery);
  const queries = [canonicalQuery, ...variants];

  const responses = await Promise.all(
    queries.map((q) =>
      axios.get<SearchResponse>(
        `${EBAY_BASE_URL}/buy/browse/v1/item_summary/search`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
            "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS",
          },
          params: {
            q,
            // Pa: enable eBay's own spell correction. Adds ~200ms latency
            // but gets us the free wins (it'll auto-correct mass-market
            // misspellings before they hit the API search). When eBay
            // doesn't correct, our own variants + fuzzy filter still catch
            // the niche misspellings their model considers low-confidence.
            auto_correct: "KEYWORD",
            limit: fetchLimit,
            fieldgroups: "EXTENDED",
            filter: ["buyingOptions:{FIXED_PRICE|AUCTION}"].join(","),
          },
        }
      ).catch((err) => {
        // A variant query failing shouldn't kill the canonical results.
        // Log and treat as empty so the caller still gets canonical hits.
        console.warn(
          `[ebay] variant query failed (${q}): ${err instanceof Error ? err.message : err}`
        );
        return { data: { itemSummaries: [] } } as { data: SearchResponse };
      })
    )
  );

  // Dedupe by ebayItemId across canonical + variants. The canonical query's
  // items come first so they win the seen-set race; variants only add
  // listings the canonical missed.
  const seen = new Set<string>();
  const dedupedRaw: EbayListingRaw[] = [];
  let rawTotal = 0;
  for (const r of responses) {
    const items = r.data.itemSummaries ?? [];
    rawTotal += items.length;
    for (const item of items) {
      // P5: stop dropping pure-auction listings. `normaliseItem` now uses
      // currentBidPrice when item.price is absent. We still need *some*
      // numeric price to score against — drop only if both are missing,
      // which is rare (typically a malformed item).
      if (item.price?.value == null && item.currentBidPrice?.value == null) continue;
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      dedupedRaw.push(item);
    }
  }

  const normalised = dedupedRaw.map(normaliseItem);
  const filtered = titleFilter(normalised, cleanName, cardNumber, setName);

  // Visibility: log filter precision so we can spot over-strict cases.
  const queryCount = queries.length;
  if (normalised.length > 0 && filtered.length === 0) {
    const dropped = normalised
      .slice(0, 5)
      .map((l) => l.title)
      .join(" | ");
    console.log(
      `[ebay] "${cleanName}" #${cardNumber ?? "?"} (${setName ?? "?"}): ` +
        `${queryCount} queries → ${rawTotal} raw / ${normalised.length} unique / ` +
        `0 after filter. samples: ${dropped}`
    );
  } else {
    // Break out the kind counts so we can spot when auction recall changes.
    let auctionOnly = 0;
    let binPlus = 0;
    let bin = 0;
    for (const l of filtered) {
      if (l.kind === "AUCTION_ONLY") auctionOnly++;
      else if (l.kind === "BIN_PLUS_AUCTION") binPlus++;
      else bin++;
    }
    console.log(
      `[ebay] "${cleanName}" #${cardNumber ?? "?"} (${setName ?? "?"}): ` +
        `${queryCount} queries → ${rawTotal} raw / ${normalised.length} unique / ` +
        `${filtered.length} after filter ` +
        `(bin=${bin}, bin+auction=${binPlus}, auction_only=${auctionOnly})`
    );
  }

  // P5: top-N by dealScore would drop auctions (they score lower because the
  // current bid isn't the final price). Take the user's `limit` budget of
  // best-scoring listings *plus* a parallel budget of upcoming auctions
  // sorted by end time, then dedupe. The result is a single set that fills
  // both the "All listings" tab and the "Live auctions" tab.
  const auctionBudget = Math.max(10, Math.floor(limit / 2));
  const byScore = filtered.slice(0, limit); // already dealScore-sorted upstream

  const auctions = filtered
    .filter((l) => l.kind === "AUCTION_ONLY" || l.kind === "BIN_PLUS_AUCTION")
    .filter((l) => l.endTime && l.endTime.getTime() > Date.now())
    .sort((a, b) => a.endTime!.getTime() - b.endTime!.getTime())
    .slice(0, auctionBudget);

  const seenIds = new Set<string>();
  const out: NormalisedListing[] = [];
  for (const l of [...byScore, ...auctions]) {
    if (seenIds.has(l.ebayItemId)) continue;
    seenIds.add(l.ebayItemId);
    out.push(l);
  }
  return out;
}

/**
 * Filter eBay listings down to the specific card printing.
 *
 * Many cards share a name across multiple sets (e.g. Mew exists in Celebrations,
 * Evolutions, Black Star Promos, and a dozen other sets — each with very
 * different market prices). A title-only-by-name filter lets a $4 Promo Mew
 * masquerade as a "HOT deal" against a $73 Celebrations Mew market price.
 *
 * Precision rule: title must contain the card name AND at least one
 * printing-disambiguator (set name OR card number). Card numbers commonly
 * appear as "53/108" so we accept both bare ("25") and "x/total" forms.
 */
/**
 * Search eBay for multi-card LOT listings (Pb).
 *
 * Different shape from `searchEbayListings`:
 *   - The query is the user's free text ("charizard lot", "pokemon binder")
 *     — we don't quote a single card name.
 *   - We *don't* apply the single-card title filter — the whole point is
 *     listings with multiple cards in the title.
 *   - We still apply the accessory blocklist (a sleeve called "Pokemon Lot"
 *     is still a sleeve) and the price-floor sanity check.
 *
 * Returns NormalisedListing[]. The caller hands these to the cardNameExtractor
 * + lotValuation pipeline to produce parsed Lot objects.
 */
export async function searchEbayLots(
  query: string,
  limit = 30
): Promise<NormalisedListing[]> {
  const token = await getEbayToken();
  const fetchLimit = Math.min(Math.max(limit * 5, 100), 200);

  const response = await axios.get<SearchResponse>(
    `${EBAY_BASE_URL}/buy/browse/v1/item_summary/search`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DUS",
      },
      params: {
        q: query,
        auto_correct: "KEYWORD",
        limit: fetchLimit,
        fieldgroups: "EXTENDED",
        filter: ["buyingOptions:{FIXED_PRICE|AUCTION}"].join(","),
      },
    }
  );

  const items = response.data.itemSummaries ?? [];
  const normalised = items
    .filter((item) => item.price?.value != null || item.currentBidPrice?.value != null)
    .map(normaliseItem);

  // For LOT searches we use the lenient blocklist — "binder", "mystery
  // pack", "repack" are legitimate ways to sell multi-card lots, but
  // sleeves, lighters, rugs etc. are still off the table.
  return normalised
    .filter((l) => !isAccessoryListing(l.title, { allowLotPackaging: true }))
    .slice(0, limit);
}

/**
 * Hard-accessory terms — never legitimate even for lot listings.
 * Sleeves, lighters, rugs, art frames etc. are not card sales regardless
 * of how many cards the title claims to depict.
 */
const HARD_ACCESSORY_TERMS = [
  "display case", "screwdown", "screw down", "sleeve", "toploader",
  "top loader", "protector", "graded guard", "psa guard", "holder",
  "playmat", "magnet",
  "slab skin", "slab insert", "insert /", "psa insert", "cgc insert",
  "graded insert", "ace insert", "bumper", "art frame", "frame for",
  "5x7 frame", "for psa", "for cgc", "for bgs", "extended art insert",
  "extended art frame", "extended art for", "tag extended",
  "multi card display", "display lot",
  "keychain", "key chain", "sticker", "credit card sticker", "decal",
  "wind resistant", "lighter", "rug ", " rug", "carpet", "mousepad",
  "mouse pad", "poster", "shirt", "t-shirt", "tshirt", "hoodie", "mug",
  "tumbler", "pin badge", " pin set", "wallpaper",
  "no card", "no cards", "art only", "no actual card", "card not included",
];

/**
 * Lot-ambiguous terms — these flag accessories for single-card listings
 * but are legitimate multi-card sales (binder lots, mystery packs of
 * actual cards, repacks). The lot path bypasses them.
 */
const LOT_AMBIGUOUS_TERMS = [
  "card binder", " binder", "deck box",
  "mystery chase pack", "mystery pack", "repack",
];

/**
 * Returns true if a title is an accessory/merch item, not a card sale.
 * Stricter for single-card listings; pass `allowLotPackaging: true` from
 * the lot pipeline to keep binder/repack/mystery-pack listings.
 */
export function isAccessoryListing(
  title: string,
  opts: { allowLotPackaging?: boolean } = {}
): boolean {
  const t = title.toLowerCase();
  if (HARD_ACCESSORY_TERMS.some((term) => t.includes(term))) return true;
  if (!opts.allowLotPackaging && LOT_AMBIGUOUS_TERMS.some((term) => t.includes(term))) return true;
  return false;
}

// Exported for unit testing; production callers use searchEbayListings.
export function titleFilter(
  listings: NormalisedListing[],
  cardName: string,
  cardNumber: string | null | undefined,
  setName: string | null | undefined
): NormalisedListing[] {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 /]+/g, " ").replace(/\s+/g, " ").trim();

  const needleName = norm(cardName);
  // Bare card number ("25" from "25/25", or just "25"). Filter to digit-only
  // to keep promo prefixes (SM215, GG10) intact via the literal-form too.
  const numberLiteral = cardNumber ? cardNumber.trim().toLowerCase() : null;
  const numberBare = cardNumber ? cardNumber.split("/")[0].trim().toLowerCase() : null;
  // Set name tokens (≥4 chars) — "Celebrations" → ["celebrations"]; skip stop
  // words like "the", "and", "of" which would over-match.
  const setTokens =
    setName
      ? norm(setName)
          .split(" ")
          .filter((t) => t.length >= 4)
      : [];

  // Word-boundary check: needs to be a standalone token, not a substring.
  // e.g. "25" must not match "250" in "Fusion Strike 250/264".
  const tokenRegex = (token: string) =>
    new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);

  // Anti-accessory filter delegates to the shared isAccessoryListing helper
  // (single-card mode includes "binder" / "mystery pack" / "repack" as
  // accessories). Price-floor sanity-check for anything that slips past
  // happens at the scoring step in dealScore.ts.

  return listings.filter((l) => {
    if (isAccessoryListing(l.title)) return false;

    const hay = norm(l.title);

    // Pa: fuzzy card-name match. The card name itself is allowed to differ
    // from the title by up to 2 edits — catches "Charzard" / "Pokmon Mew"
    // class of seller typos. Disambiguator (set/number) still has to match
    // exactly to prevent false positives blowing up the result set.
    //
    // For very short names (<5 chars: "Mew", "Mr Mime") we tighten to 0
    // edits — Levenshtein-2 on a 3-char needle accepts "Mewtwo" as "Mew",
    // which is the wrong call when the disambiguator is shared (a Mewtwo
    // card from the same set as Mew). Long names are robust enough that
    // even 2 edits leave the result unambiguous.
    const fuzzMax = needleName.length >= 5 ? 2 : 0;
    if (!containsFuzzy(hay, needleName, fuzzMax)) return false;

    // Disambiguator: set name token OR card number must appear, as a whole token.
    if (numberLiteral && tokenRegex(numberLiteral).test(hay)) return true;
    if (numberBare && tokenRegex(numberBare).test(hay)) return true;
    if (setTokens.some((t) => hay.includes(t))) return true;

    return false;
  });
}

// ─── Normalisation helper ─────────────────────────────────────────────────────

/**
 * Convert a raw eBay item summary into our clean internal shape.
 * Key decisions:
 *  - shippingCost: null when eBay says "FREE" or cost is $0.00
 *  - totalCost:    listingPrice + (shippingCost ?? 0)
 *  - listingType:  AUCTION when buyingOptions includes "AUCTION"
 */
// Exported for unit testing the shape-derivation logic.
export function normaliseItem(item: EbayListingRaw): NormalisedListing {
  // P5: pick the reference price across the three listing shapes:
  //   - BIN / BIN_PLUS_AUCTION  →  use item.price (Buy It Now)
  //   - AUCTION_ONLY            →  use item.currentBidPrice (no BIN exists)
  //
  // Previously we dropped any item with no `item.price.value` — that hid
  // every pure-auction listing from the UI. Now we score them against the
  // current bid at fetch time (snapshot, since the bid will rise).
  const hasBin = item.price?.value != null;
  const hasAuction = item.buyingOptions.includes("AUCTION");
  const listingPrice = hasBin
    ? parseFloat(item.price!.value)
    : parseFloat(item.currentBidPrice?.value ?? "0");

  // Determine shipping cost — null means free
  let shippingCost: number | null = null;
  const shippingOption = item.shippingOptions?.[0];
  if (shippingOption) {
    const isFree =
      shippingOption.shippingCostType === "FREE" ||
      parseFloat(shippingOption.shippingCost?.value ?? "0") === 0;
    if (!isFree && shippingOption.shippingCost) {
      shippingCost = parseFloat(shippingOption.shippingCost.value);
    }
  }

  const totalCost = listingPrice + (shippingCost ?? 0);

  // Derive the precise ListingKind. The Browse API's `buyingOptions` array
  // is the authoritative source: it always includes "AUCTION" / "FIXED_PRICE"
  // (or both) — we just split them into the three product-relevant buckets.
  let kind: ListingKind;
  if (hasBin && hasAuction) kind = "BIN_PLUS_AUCTION";
  else if (hasBin) kind = "BIN";
  else kind = "AUCTION_ONLY";

  return {
    ebayItemId: item.itemId,
    title: item.title,
    imageUrl: item.thumbnailImages?.[0]?.imageUrl ?? null,
    ebayUrl: item.itemAffiliateWebUrl ?? item.itemWebUrl,
    listingPrice,
    shippingCost,
    totalCost,
    listingType: hasAuction ? "AUCTION" : "FIXED_PRICE",
    kind,
    condition: item.condition ?? null,
    conditionGrade: parseConditionFromTitle(item.title),
    seller: item.seller?.username ?? null,
    sellerFeedback: item.seller?.feedbackPercentage
      ? parseFloat(item.seller.feedbackPercentage)
      : null,
    bids: item.bidCount ?? null,
    endTime: item.itemEndDate ? new Date(item.itemEndDate) : null,
  };
}
