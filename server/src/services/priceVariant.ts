import type { CardmarketPrices, VariantPriceMap } from "./pokemontcg.js";
import { scrapeTcgplayerPrices } from "./tcgplayerScrape.js";

/**
 * Where a market price came from. Drives the chip in the UI and the
 * currency label on the deal bar.
 */
export type PriceSource =
  | "tcgplayer" // pokemontcg.io tcgplayer.prices
  | "tcgplayer_scrape" // our scraping fallback
  | "cardmarket" // pokemontcg.io cardmarket.prices (EUR)
  | "none"; // nothing — listing will be UNSCORED

export interface ResolvedMarketPrice {
  market: number;
  source: PriceSource;
  currency: string;
}

/**
 * Extract the TCGPlayer market price for a specific variant from a
 * PriceCache.variants payload. Returns null if either the variants object
 * is missing/null or the requested variant isn't present.
 *
 * Variant keys are pokemontcg.io's raw names: "normal", "holofoil",
 * "reverseHolofoil", "1stEdition", "1stEditionHolofoil", "unlimited", etc.
 */
export function getMarketForVariant(
  variants: unknown,
  variant: string
): number | null {
  if (!variants || typeof variants !== "object") return null;
  const map = variants as VariantPriceMap;
  const v = map[variant];
  if (!v) return null;
  return v.market ?? null;
}

/**
 * Pick the right cardmarket price for a TCGPlayer-style variant. cardmarket
 * is per-card (not per-variant) so we mostly return trendPrice; reverse-holo
 * variants have their own separate aggregates.
 */
export function getCardmarketForVariant(
  cardmarketPrices: CardmarketPrices | null,
  variant: string
): number | null {
  if (!cardmarketPrices) return null;
  if (variant === "reverseHolofoil") {
    return (
      cardmarketPrices.reverseHoloTrend ??
      cardmarketPrices.reverseHoloSell ??
      cardmarketPrices.trendPrice ??
      cardmarketPrices.averageSellPrice ??
      null
    );
  }
  return (
    cardmarketPrices.trendPrice ?? cardmarketPrices.averageSellPrice ?? null
  );
}

/**
 * Four-tier market-price resolver. Try in order:
 *   1. pokemontcg.io tcgplayer.prices (cached)        — USD, per-variant
 *   2. Our TCGPlayer scrape fallback                  — USD, single number
 *   3. pokemontcg.io cardmarket.prices                — EUR, per-card-ish
 *   4. None → caller should mark the listing UNSCORED — no comparison
 *
 * Caller passes everything it already has in hand so we don't re-fetch.
 */
export async function resolveMarketPrice(args: {
  pokemonTcgId: string;
  cardName: string;
  setName: string | null;
  cardNumber: string | null;
  variant: string;
  tcgplayerVariants: unknown; // PriceCache.variants JSON
  cardmarketPrices: CardmarketPrices | null;
}): Promise<ResolvedMarketPrice | null> {
  // 1. TCGPlayer (from pokemontcg.io)
  const tcg = getMarketForVariant(args.tcgplayerVariants, args.variant);
  if (tcg != null && tcg > 0) {
    return { market: tcg, source: "tcgplayer", currency: "USD" };
  }

  // 2. TCGPlayer scrape fallback
  const scraped = await scrapeTcgplayerPrices(
    args.pokemonTcgId,
    args.cardName,
    args.setName,
    args.cardNumber
  );
  if (
    scraped?.status === "ok" &&
    scraped.prices?.market != null &&
    scraped.prices.market > 0
  ) {
    return {
      market: scraped.prices.market,
      source: "tcgplayer_scrape",
      currency: scraped.prices.currency,
    };
  }

  // 3. Cardmarket
  const cm = getCardmarketForVariant(args.cardmarketPrices, args.variant);
  if (cm != null && cm > 0) {
    return { market: cm, source: "cardmarket", currency: "EUR" };
  }

  // 4. Nothing
  return null;
}

/**
 * Map a TCGPlayer variant key to extra search keywords for the eBay query.
 * "Normal" cards don't add anything; foil variants surface listings tagged
 * with those terms.
 */
export function variantToEbayKeyword(variant: string): string {
  switch (variant) {
    case "reverseHolofoil":
      return "reverse holo";
    case "holofoil":
    case "unlimitedHolofoil":
      return "holo";
    case "1stEdition":
      return "1st edition";
    case "1stEditionHolofoil":
      return "1st edition holo";
    case "unlimited":
      return "unlimited";
    default:
      return "";
  }
}

/** Human-readable label for a variant, used by both server logs and UI hints. */
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
