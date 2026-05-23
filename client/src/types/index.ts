// ─── Enums (mirror Prisma schema) ─────────────────────────────────────────────

export type DealTier = "HOT" | "GOOD" | "FAIR" | "OVER" | "UNSCORED";
export type ListingType = "AUCTION" | "FIXED_PRICE";
/** Precise listing shape — distinguishes pure auctions from BIN listings. */
export type ListingKind = "AUCTION_ONLY" | "BIN" | "BIN_PLUS_AUCTION";
/** Where the marketPrice on a listing came from. */
export type PriceSource =
  | "tcgplayer"
  | "tcgplayer_scrape"
  | "cardmarket"
  | "none";
/** Card condition grade parsed from listing title; drives the market multiplier. */
export type ConditionGrade =
  | "NM"
  | "LP"
  | "MP"
  | "HP"
  | "DMG"
  | "GRADED"
  | "UNKNOWN";

// ─── TCGPlayer price shape (via pokemontcg.io) ───────────────────────────────

/** Price tier returned for every TCGPlayer variant */
export interface VariantPrices {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
  directLow: number | null;
}

/** Map of variant key → its price tier. Keys are pokemontcg.io variant names. */
export type VariantPriceMap = Record<string, VariantPrices>;

// ─── API response shapes ───────────────────────────────────────────────────────

export interface PriceCache {
  id: string;
  cardId: string;
  /** Full TCGPlayer prices keyed by variant. Null when no TCGPlayer data is available. */
  variants: VariantPriceMap | null;
  fetchedAt: string;
  expiresAt: string;
}

export interface Listing {
  id: string;
  cardId: string;
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  /** Base listing price before shipping */
  listingPrice: number;
  /** null = free shipping */
  shippingCost: number | null;
  /** listingPrice + (shippingCost ?? 0) */
  totalCost: number;
  /** NM market reference. Can be 0 when no source had data (UNSCORED). */
  marketPrice: number;
  /** Where marketPrice came from — drives the source chip in the UI. */
  priceSource: PriceSource | null;
  /** ISO 4217 currency for marketPrice. USD for tcgplayer*, EUR for cardmarket. */
  priceCurrency: string | null;
  /** marketPrice × condition multiplier — what dealScore is actually computed against. */
  adjustedMarketPrice: number | null;
  /** Parsed condition: NM | LP | MP | HP | DMG | GRADED | UNKNOWN. */
  conditionGrade: ConditionGrade | null;
  dealScore: number;
  dealTier: DealTier;
  listingType: ListingType;
  /** Precise listing shape. Null on rows fetched before P5 — treat as BIN. */
  kind: ListingKind | null;
  /** eBay's coarse condition string ("Ungraded", "Used", etc.). */
  condition: string | null;
  seller: string | null;
  sellerFeedback: number | null;
  bids: number | null;
  endTime: string | null; // ISO date string
  fetchedAt: string;
  expiresAt: string;
}

export interface WatchedCard {
  id: string;
  userId: string;
  /** pokemontcg.io card ID (e.g. "base1-4") */
  pokemonTcgId: string;
  cardName: string;
  setName: string;
  cardNumber: string | null;
  /** TCGPlayer variant key (e.g. "normal", "holofoil") */
  variant: string;
  /** Optional user-set target. When totalCost ≤ this on a fresh listing,
   *  the refresh job creates a TARGET_HIT alert. */
  targetPrice: number | null;
  createdAt: string;
  updatedAt: string;
  /** Best current listing included on GET /api/cards */
  listings?: Listing[];
  priceCache?: PriceCache | null;
}

// ─── Alerts (P3 + P4) ────────────────────────────────────────────────────────

export type AlertKind = "TARGET_HIT" | "HOT_DEAL";

export interface Alert {
  id: string;
  kind: AlertKind;
  readAt: string | null;
  createdAt: string;
  card: {
    id: string;
    cardName: string;
    setName: string;
    cardNumber: string | null;
    variant: string;
    targetPrice: number | null;
  };
  listing: {
    id: string;
    title: string;
    imageUrl: string | null;
    ebayUrl: string;
    totalCost: number | string;
    dealTier: DealTier;
    dealScore: number;
    condition: string | null;
    conditionGrade: ConditionGrade | null;
    expiresAt: string;
  } | null;
  listingExpired: boolean;
}

// ─── Catalog (pokemontcg.io) types ───────────────────────────────────────────

/** A search result from GET /api/catalog/search */
export interface CatalogCard {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  setId: string;
  setName: string;
  setSeries: string;
  imageSmall: string | null;
  imageLarge: string | null;
  /** Available variant keys for this card */
  variants: string[];
  /** Full TCGPlayer prices keyed by variant */
  variantPrices: VariantPriceMap;
  /** Market price of the first variant (for preview rendering) */
  previewMarket: number | null;
}

export interface CatalogSearchResponse {
  results: CatalogCard[];
}

// ─── Lots (Pb) ───────────────────────────────────────────────────────────────

/** One candidate printing for an extracted card name in a lot title. */
export interface LotCandidatePrinting {
  cardId: string;
  setName: string;
  setReleaseDate: string | null;
  number: string;
  market: number | null;
  currency: string;
}

/** One parsed card from a lot title with its candidate printings. */
export interface ParsedLotCard {
  name: string;
  quantity: number;
  confidence: number;
  candidates: LotCandidatePrinting[];
}

/** A multi-card lot listing with valuation. */
export interface Lot {
  id: string;
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  listingPrice: number;
  shippingCost: number | null;
  totalCost: number;
  lowEstimate: number;
  highEstimate: number;
  lotScore: number;
  lotTier: DealTier;
  kind: ListingKind | null;
  bids: number | null;
  endTime: string | null;
  parsedCards: ParsedLotCard[];
}

export interface LotsSearchResponse {
  query: string;
  rawEbayCount: number;
  lotShapedCount: number;
  withCardsCount: number;
  lots: Lot[];
}

/** One card the user manually added to a lot via the analyzer. */
export interface AddedLotCard {
  cardId: string;
  quantity: number;
  note?: string | null;
}

/** Summary returned by PUT /api/lots/:id/annotation for re-rendering. */
export interface AddedLotCardSummary {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  market: number | null;
  quantity: number;
  note: string | null;
}

export interface LotAnnotation {
  ebayItemId: string;
  addedCards: AddedLotCard[];
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Server's recompute including user additions. */
export interface LotRevaluation {
  autoLowEstimate: number;
  autoHighEstimate: number;
  withAnnotationLowEstimate: number;
  withAnnotationHighEstimate: number;
  addedCardSummaries: AddedLotCardSummary[];
}

export interface LotImage {
  position: number;
  imageUrl: string;
}

/** Pc — One AI-detected card from a lot's photos. */
export interface LotSuggestion {
  name: string;
  quantity: number;
  confidence: number;
  candidates: LotCandidatePrinting[];
  setHint: string | null;
  cardNumber: string | null;
  sourceImagePosition: number | null;
}

export interface LotSuggestionsResponse {
  ebayItemId: string;
  suggestions: LotSuggestion[];
  cacheStatus: "cached" | "partial" | "fresh";
  imagesProcessed: number;
}

// ─── Form / mutation payloads ─────────────────────────────────────────────────

export interface CreateCardPayload {
  pokemonTcgId: string;
  variant: string;
  /** Optional client hints — server re-fetches from catalog for authoritative values */
  cardName?: string;
  setName?: string;
  cardNumber?: string;
}

export interface UpdateCardPayload {
  variant?: string;
  /** Set to null or 0 to clear the target; null is canonical "no target." */
  targetPrice?: number | null;
}

// ─── Variant helpers (mirror server/src/services/priceVariant.ts) ────────────

/**
 * Extract the TCGPlayer market price for a given variant from a PriceCache.
 * Returns null when the cache or the variant entry is missing.
 */
export function getMarketForVariant(
  priceCache: Pick<PriceCache, "variants"> | null | undefined,
  variant: string
): number | null {
  if (!priceCache?.variants) return null;
  const v = priceCache.variants[variant];
  if (!v) return null;
  return v.market != null ? Number(v.market) : null;
}

/** Human-readable label for a variant — used in chips, dropdowns, copy. */
export function variantLabel(variant: string): string {
  switch (variant) {
    case "normal":               return "Normal";
    case "holofoil":             return "Holofoil";
    case "reverseHolofoil":      return "Reverse Holo";
    case "1stEdition":           return "1st Edition";
    case "1stEditionHolofoil":   return "1st Edition Holo";
    case "unlimited":            return "Unlimited";
    case "unlimitedHolofoil":    return "Unlimited Holo";
    default:                     return variant;
  }
}

// ─── API response wrappers ────────────────────────────────────────────────────

export interface ListingsResponse {
  listings: Listing[];
  fromCache: boolean;
}

export interface PricesResponse {
  prices: PriceCache;
  fromCache: boolean;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

export interface DealTierConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export const DEAL_TIER_CONFIG: Record<DealTier, DealTierConfig> = {
  HOT:      { label: "🔥 Hot Deal",   color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.35)" },
  GOOD:     { label: "✅ Good Deal",  color: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)"  },
  FAIR:     { label: "⚠️ Fair",       color: "#facc15", bg: "rgba(250,204,21,0.12)",  border: "rgba(250,204,21,0.35)"  },
  OVER:     { label: "❌ Overpriced", color: "#64748b", bg: "rgba(100,116,139,0.12)", border: "#334155"                },
  // No market reference — listing surfaced but not graded. Neutral colour so
  // users don't read it as either positive or negative signal.
  UNSCORED: { label: "— Unscored",     color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.30)" },
};
