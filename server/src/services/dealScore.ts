import { DealTier } from "@prisma/client";
import type { NormalisedListing } from "./ebay.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DealResult {
  dealScore: number;
  dealTier: DealTier;
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
  listing: Pick<NormalisedListing, "listingPrice" | "shippingCost" | "totalCost">,
  marketPrice: number
): DealResult {
  if (marketPrice <= 0) {
    return { dealScore: 0, dealTier: DealTier.FAIR };
  }

  const score = Math.round(
    ((marketPrice - listing.totalCost) / marketPrice) * 100
  );

  const dealTier = scoreToDealTier(score);
  return { dealScore: score, dealTier };
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
    .map((l) => ({ ...l, ...calculateDealScore(l, marketPrice) }))
    .sort((a, b) => b.dealScore - a.dealScore);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreToDealTier(score: number): DealTier {
  if (score > TIER_THRESHOLDS.HOT)  return DealTier.HOT;
  if (score > TIER_THRESHOLDS.GOOD) return DealTier.GOOD;
  if (score >= TIER_THRESHOLDS.FAIR) return DealTier.FAIR;
  return DealTier.OVER;
}
