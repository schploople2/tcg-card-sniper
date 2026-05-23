import { describe, it, expect } from "vitest";
import {
  getCardmarketForVariant,
  getMarketForVariant,
  variantLabel,
  variantToEbayKeyword,
} from "../priceVariant.js";
import type { CardmarketPrices } from "../pokemontcg.js";

describe("getMarketForVariant", () => {
  const variants = {
    normal: { low: 1, mid: 2, high: 5, market: 2.5, directLow: 1.5 },
    holofoil: { low: 50, mid: 75, high: 200, market: 80, directLow: 60 },
  };

  it("returns the market price for an existing variant", () => {
    expect(getMarketForVariant(variants, "holofoil")).toBe(80);
  });

  it("returns null for missing variant", () => {
    expect(getMarketForVariant(variants, "reverseHolofoil")).toBeNull();
  });

  it("returns null for null/missing variants payload", () => {
    expect(getMarketForVariant(null, "holofoil")).toBeNull();
    expect(getMarketForVariant(undefined, "holofoil")).toBeNull();
  });

  it("returns null when the variant exists but has no market field", () => {
    const broken = { holofoil: { low: 50, mid: 75, high: 200, market: null, directLow: 60 } };
    expect(getMarketForVariant(broken, "holofoil")).toBeNull();
  });
});

describe("getCardmarketForVariant", () => {
  const cm: CardmarketPrices = {
    averageSellPrice: 9.67,
    lowPrice: 8,
    trendPrice: 9.32,
    reverseHoloTrend: 9.86,
    reverseHoloSell: 8.5,
  };

  it("returns trendPrice for non-reverse-holo variants", () => {
    expect(getCardmarketForVariant(cm, "holofoil")).toBe(9.32);
    expect(getCardmarketForVariant(cm, "normal")).toBe(9.32);
  });

  it("returns reverseHoloTrend for the reverseHolofoil variant", () => {
    expect(getCardmarketForVariant(cm, "reverseHolofoil")).toBe(9.86);
  });

  it("falls back through trendPrice → averageSellPrice when reverseHolo aggregates are missing", () => {
    const withoutReverse: CardmarketPrices = {
      averageSellPrice: 9.67,
      lowPrice: 8,
      trendPrice: 9.32,
      reverseHoloTrend: null,
      reverseHoloSell: null,
    };
    expect(getCardmarketForVariant(withoutReverse, "reverseHolofoil")).toBe(9.32);
  });

  it("returns null when input is null", () => {
    expect(getCardmarketForVariant(null, "holofoil")).toBeNull();
  });
});

describe("variantToEbayKeyword", () => {
  it.each([
    ["holofoil", "holo"],
    ["unlimitedHolofoil", "holo"],
    ["reverseHolofoil", "reverse holo"],
    ["1stEdition", "1st edition"],
    ["1stEditionHolofoil", "1st edition holo"],
    ["unlimited", "unlimited"],
    ["normal", ""],
    ["unknownNewVariantTypeFromFuture", ""],
  ])("%s → %s", (input, expected) => {
    expect(variantToEbayKeyword(input)).toBe(expected);
  });
});

describe("variantLabel", () => {
  it("returns human-readable labels", () => {
    expect(variantLabel("holofoil")).toBe("Holofoil");
    expect(variantLabel("reverseHolofoil")).toBe("Reverse Holo");
  });

  it("falls back to the raw variant string for unknown variants", () => {
    expect(variantLabel("zMysteryVariant")).toBe("zMysteryVariant");
  });
});
