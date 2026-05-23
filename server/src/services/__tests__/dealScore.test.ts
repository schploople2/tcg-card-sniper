import { describe, it, expect } from "vitest";
import {
  calculateDealScore,
  isAuctionAlert,
  scoreAndSort,
} from "../dealScore.js";
import type { NormalisedListing } from "../ebay.js";

/**
 * Build a minimal listing fixture. Only the fields read by dealScore are
 * required; the rest are filler so the type satisfies the production shape.
 */
function listing(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    ebayItemId: "v1|abc|0",
    title: "Test Title",
    imageUrl: null,
    ebayUrl: "https://example.com",
    listingPrice: 50,
    shippingCost: null,
    totalCost: 50,
    listingType: "FIXED_PRICE",
    kind: "BIN",
    condition: null,
    conditionGrade: "UNKNOWN",
    seller: null,
    sellerFeedback: null,
    bids: null,
    endTime: null,
    ...overrides,
  };
}

describe("calculateDealScore — condition multipliers", () => {
  // NM Charizard market is $100. The tier math: HOT >25, GOOD 10-25, FAIR 0-10, OVER<0.
  const market = 100;

  it("NM listing at full market scores ~0 (FAIR)", () => {
    const r = calculateDealScore(
      listing({ totalCost: 100, conditionGrade: "NM" }),
      market
    );
    expect(r.dealScore).toBe(0);
    expect(r.dealTier).toBe("FAIR");
    expect(r.adjustedMarketPrice).toBe(100);
  });

  it("UNKNOWN condition behaves as NM (multiplier 1.0)", () => {
    const r = calculateDealScore(
      listing({ totalCost: 70, conditionGrade: "UNKNOWN" }),
      market
    );
    // (100 - 70)/100 = 30% → HOT
    expect(r.dealScore).toBe(30);
    expect(r.dealTier).toBe("HOT");
  });

  it("MP listing scored against 0.65×market", () => {
    // adjusted = 100 * 0.65 = 65; listing $50 vs $65 = ~23% off → GOOD
    const r = calculateDealScore(
      listing({ totalCost: 50, conditionGrade: "MP" }),
      market
    );
    expect(r.adjustedMarketPrice).toBeCloseTo(65, 2);
    expect(r.dealScore).toBe(23);
    expect(r.dealTier).toBe("GOOD");
  });

  it("HP listing scored against 0.4×market", () => {
    // adjusted = 40; listing $20 vs $40 = 50% off → HOT
    const r = calculateDealScore(
      listing({ totalCost: 20, conditionGrade: "HP" }),
      market
    );
    expect(r.adjustedMarketPrice).toBe(40);
    expect(r.dealTier).toBe("HOT");
    expect(r.dealScore).toBe(50);
  });

  it("GRADED listing scored against 1.5×market premium", () => {
    // adjusted = 150; a $120 graded card is 20% under graded market → GOOD
    const r = calculateDealScore(
      listing({ totalCost: 120, conditionGrade: "GRADED" }),
      market
    );
    expect(r.adjustedMarketPrice).toBe(150);
    expect(r.dealTier).toBe("GOOD");
    expect(r.dealScore).toBe(20);
  });

  it("OVER fires when listing exceeds adjusted market", () => {
    const r = calculateDealScore(
      listing({ totalCost: 200, conditionGrade: "NM" }),
      market
    );
    expect(r.dealTier).toBe("OVER");
    expect(r.dealScore).toBeLessThan(0);
  });

  it("UNSCORED when marketPrice <= 0 (no market reference)", () => {
    const r = calculateDealScore(
      listing({ totalCost: 50, conditionGrade: "NM" }),
      0
    );
    expect(r.dealTier).toBe("UNSCORED");
    expect(r.adjustedMarketPrice).toBe(0);
  });
});

describe("calculateDealScore — tier thresholds (regression locks)", () => {
  // Lock in the exact tier boundaries. If we ever tune them, these tests
  // become the canonical diff.
  const market = 100;

  it.each([
    [99, "FAIR"],  // 1% off — FAIR
    [90, "FAIR"],  // 10% off — boundary, FAIR per current rule (>10 needed for GOOD)
    [89, "GOOD"],  // 11% off → GOOD
    [75, "GOOD"],  // 25% off — boundary, GOOD (>25 needed for HOT)
    [74, "HOT"],   // 26% off → HOT
    [50, "HOT"],   // 50% off → HOT
    [101, "OVER"], // above market → OVER
  ])("totalCost=%d → tier=%s", (totalCost, expectedTier) => {
    const r = calculateDealScore(listing({ totalCost, conditionGrade: "NM" }), market);
    expect(r.dealTier).toBe(expectedTier);
  });
});

describe("scoreAndSort — price-floor sanity backstop", () => {
  it("drops listings priced below 15% of market when market > $50", () => {
    // Market $900, listing $10 (1.1% of market) — almost certainly a sticker
    // or accessory that slipped past the title filter. Should be dropped.
    const items = [
      listing({ ebayItemId: "v1|a|0", totalCost: 10, conditionGrade: "NM" }),
      listing({ ebayItemId: "v1|b|0", totalCost: 200, conditionGrade: "NM" }),
    ];
    const result = scoreAndSort(items, 900);
    expect(result).toHaveLength(1);
    expect(result[0].ebayItemId).toBe("v1|b|0");
  });

  it("keeps cheap listings when market is low (no floor for sub-$50)", () => {
    // Market $20, listing $2 — plausible for a junk-rare common.
    const items = [listing({ ebayItemId: "v1|a|0", totalCost: 2, conditionGrade: "NM" })];
    const result = scoreAndSort(items, 20);
    expect(result).toHaveLength(1);
  });

  it("keeps everything when market <= 0 (UNSCORED)", () => {
    const items = [
      listing({ ebayItemId: "v1|a|0", totalCost: 1, conditionGrade: "NM" }),
      listing({ ebayItemId: "v1|b|0", totalCost: 1000, conditionGrade: "NM" }),
    ];
    const result = scoreAndSort(items, 0);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.dealTier === "UNSCORED")).toBe(true);
  });

  it("sorts by dealScore descending (best deals first)", () => {
    const items = [
      listing({ ebayItemId: "v1|a|0", totalCost: 90, conditionGrade: "NM" }), // FAIR
      listing({ ebayItemId: "v1|b|0", totalCost: 50, conditionGrade: "NM" }), // HOT
      listing({ ebayItemId: "v1|c|0", totalCost: 75, conditionGrade: "NM" }), // GOOD
    ];
    const result = scoreAndSort(items, 100);
    expect(result.map((r) => r.ebayItemId)).toEqual(["v1|b|0", "v1|c|0", "v1|a|0"]);
  });
});

describe("isAuctionAlert", () => {
  const market = 100;
  const futureFar = new Date(Date.now() + 3 * 60 * 60 * 1000); // +3h
  const futureNear = new Date(Date.now() + 10 * 60 * 1000); // +10m

  it("fires when auction is >20% below market AND >1h remaining", () => {
    const l = listing({
      listingType: "AUCTION",
      totalCost: 70, // 30% below market
      endTime: futureFar,
    });
    expect(isAuctionAlert(l, market)).toBe(true);
  });

  it("does not fire on FIXED_PRICE listings even if a bargain", () => {
    const l = listing({
      listingType: "FIXED_PRICE",
      totalCost: 50,
      endTime: futureFar,
    });
    expect(isAuctionAlert(l, market)).toBe(false);
  });

  it("does not fire when <1h remaining (too late)", () => {
    const l = listing({
      listingType: "AUCTION",
      totalCost: 50,
      endTime: futureNear,
    });
    expect(isAuctionAlert(l, market)).toBe(false);
  });

  it("does not fire on a fair-priced auction", () => {
    const l = listing({
      listingType: "AUCTION",
      totalCost: 95, // only 5% under market
      endTime: futureFar,
    });
    expect(isAuctionAlert(l, market)).toBe(false);
  });
});
