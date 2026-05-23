import { DealTier } from "@prisma/client";
import type { NormalisedListing } from "./ebay.js";
import { CONDITION_MULTIPLIER } from "./ebay.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealResult {
  dealScore: number;
  dealTier: DealTier;
  /** Market price actually used for the comparison (NM market × condition multiplier). */
  adjustedMarketPrice: number;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

const TIER_THRESHOLDS = {
  HOT: 25,   // > 25% below market → 🔥 Hot Deal
  GOOD: 10,  // 10–25% below       → ✅ Good Deal
  FAIR: 0,   // 0–10% below        → ⚠️ Fair
  // below 0  → ❌ Overpriced
} as const;

/**
 * Additional flag for auctions: if current bid is > 20% below market
 * AND there is more than 1 hour remaining, we surface this as a
 * high-priority alert regardless of the standard tier.
 */
const AUCTION_ALERT_THRESHOLD = 20;
const AUCTION_ALERT_MIN_TIME_REMAINING_MS = 60 * 60 * 1000; // 1 hour

// ─── Core engine ─────────────────────────────────────────────────────────────

/**
 * Calculate the deal score and tier for a single eBay listing.
 *
 * Formula:
 *   score = ((marketPrice - totalCost) / marketPrice) × 100
 *
 * Where totalCost = listingPrice + (shippingCost ?? 0).
 * Shipping is always included so that a "$60 + $15 ship" listing
 * scores correctly against a "$72 free shipping" listing.
 *
 * @param listing     - normalised eBay listing (includes shippingCost)
 * @param marketPrice - current market price from PriceCharting (in dollars)
 */
export function calculateDealScore(
  listing: Pick<NormalisedListing, "listingPrice" | "shippingCost" | "totalCost" | "conditionGrade">,
  marketPrice: number
): DealResult {
  // No market reference → UNSCORED. Surfaces listings to the user but
  // refuses to call any of them HOT/GOOD/etc., which would be false signal.
  if (marketPrice <= 0) {
    return { dealScore: 0, dealTier: DealTier.UNSCORED, adjustedMarketPrice: 0 };
  }

  // Adjust market by the listing's condition grade. TCGPlayer's `market`
  // value is the NM (Near Mint) price. A "Moderately Played" listing at $39
  // against a $140 NM market is NOT a 72% steal — it's roughly fair, because
  // MP cards typically trade around 0.65 × market ($91). The score reflects
  // that reality so HOT only fires on actual bargains relative to condition.
  const multiplier = CONDITION_MULTIPLIER[listing.conditionGrade] ?? 1.0;
  const adjustedMarketPrice = marketPrice * multiplier;

  const score = Math.round(
    ((adjustedMarketPrice - listing.totalCost) / adjustedMarketPrice) * 100
  );

  const dealTier = scoreToDealTier(score);
  return { dealScore: score, dealTier, adjustedMarketPrice };
}

/**
 * Check if an auction deserves a high-priority alert.
 * Criteria: current bid is > 20% below market AND > 1 hour remaining.
 */
export function isAuctionAlert(
  listing: Pick<NormalisedListing, "listingType" | "totalCost" | "endTime">,
  marketPrice: number
): boolean {
  if (listing.listingType !== "AUCTION" || !listing.endTime) return false;

  const timeRemaining = listing.endTime.getTime() - Date.now();
  if (timeRemaining < AUCTION_ALERT_MIN_TIME_REMAINING_MS) return false;

  const savingsPct =
    ((marketPrice - listing.totalCost) / marketPrice) * 100;

  return savingsPct > AUCTION_ALERT_THRESHOLD;
}

/**
 * Batch-score a list of listings against a single market price.
 * Returns the listings sorted by dealScore descending (best deals first).
 */
export function scoreAndSort(
  listings: NormalisedListing[],
  marketPrice: number
): Array<NormalisedListing & DealResult> {
  return listings
    .filter((l) => isPlausiblePriceForCard(l.totalCost, marketPrice))
    .map((l) => ({ ...l, ...calculateDealScore(l, marketPrice) }))
    .sort((a, b) => b.dealScore - a.dealScore);
}

/**
 * Drop listings whose price is implausibly low compared to market — a
 * last-line backstop against accessories ("$11 Pokemon Mew ex card sticker")
 * that pass the title filter by including the card name + number in their
 * titles for SEO.
 *
 * Rule: when market > $50, the listing must be at least 15% of market.
 *   - $900 market → reject anything below $135 (catches the $11 stickers)
 *   - $30 market  → no rule applied (a $5 cheap card is still plausible)
 *
 * 15% may seem generous but graded examples of high-value cards genuinely
 * sell well below market when ungraded or damaged, so we err on the side of
 * keeping borderline listings rather than over-filtering.
 */
function isPlausiblePriceForCard(totalCost: number, marketPrice: number): boolean {
  // UNSCORED listings have no market reference — keep them all and let the
  // user judge. The accessory-keyword filter in ebay.ts is our only line of
  // defence in this mode.
  if (marketPrice <= 0) return true;
  if (marketPrice < 50) return true;
  return totalCost >= marketPrice * 0.15;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreToDealTier(score: number): DealTier {
  if (score > TIER_THRESHOLDS.HOT)  return DealTier.HOT;
  if (score > TIER_THRESHOLDS.GOOD) return DealTier.GOOD;
  if (score >= TIER_THRESHOLDS.FAIR) return DealTier.FAIR;
  return DealTier.OVER;
}
