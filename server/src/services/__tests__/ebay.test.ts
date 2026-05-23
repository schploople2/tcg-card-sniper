import { describe, it, expect } from "vitest";
import {
  CONDITION_MULTIPLIER,
  normaliseItem,
  parseConditionFromTitle,
  titleFilter,
} from "../ebay.js";
import type { EbayListingRaw, NormalisedListing } from "../ebay.js";

function listing(title: string, over: Partial<NormalisedListing> = {}): NormalisedListing {
  return {
    ebayItemId: `v1|${title.slice(0, 6)}|0`,
    title,
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
    ...over,
  };
}

describe("parseConditionFromTitle", () => {
  // Lock the matching precedence first — graded slabs trump grade letters.
  describe("graded slab detection (highest precedence)", () => {
    it.each([
      "Charizard 4/102 Base Set PSA 9",
      "1999 Pokémon Mew Base BGS 9.5",
      "Sylveon EX RC32 CGC 10 Pristine",
      "Mew Promo 8 SGC 8",
      "Pokemon Charizard TAG 9 graded",
    ])("graded: %s", (title) => {
      expect(parseConditionFromTitle(title)).toBe("GRADED");
    });

    it("matches lowercase psa", () => {
      expect(parseConditionFromTitle("charizard psa 9 base set")).toBe("GRADED");
    });

    it("graded check works even when the title also says MP/LP", () => {
      // PSA cards are slabs; the MP letter token shouldn't override.
      expect(parseConditionFromTitle("Charizard PSA 9 MP base set")).toBe("GRADED");
    });
  });

  describe("raw condition grades", () => {
    it.each([
      ["Charizard NM/M holo", "NM"],
      ["Mew Near Mint Celebrations", "NM"],
      ["Sylveon EX LP Generations", "LP"],
      ["Pikachu lightly played base", "LP"],
      ["Mew MP Celebrations", "MP"],
      ["Charizard Moderately Played", "MP"],
      ["Charizard HP base set", "HP"],
      ["Mew Heavily Played", "HP"],
      ["Mew Damaged Played", "DMG"],
      ["DMG Charizard base set", "DMG"],
    ])("'%s' → %s", (title, expected) => {
      expect(parseConditionFromTitle(title)).toBe(expected);
    });
  });

  describe("ambiguous / no-grade titles", () => {
    it("returns UNKNOWN when title has no condition tokens", () => {
      expect(parseConditionFromTitle("Pokemon Charizard 4/102 Base Set Holo")).toBe(
        "UNKNOWN"
      );
    });

    it("does NOT match MP as a substring inside Pokémon", () => {
      // "Pokémon" contains no MP — but the lowered "pokemon" doesn't either,
      // we're guarding against a future regex regression where MP is matched
      // greedily inside arbitrary tokens.
      expect(parseConditionFromTitle("Pokémon Charizard 4/102")).toBe("UNKNOWN");
    });

    it("matches MP inside parens (common eBay format)", () => {
      expect(parseConditionFromTitle("Charizard 4/102 (MP) base set")).toBe("MP");
    });

    it("does NOT mis-match 'mint' inside arbitrary text like 'mint condition lot'", () => {
      // The current regex catches `\bmint\b` — this title has "mint" as a
      // standalone word, so NM fires. Document the contract.
      expect(parseConditionFromTitle("Pokemon lot mint condition")).toBe("NM");
    });
  });

  describe("precedence ordering (most-specific wins)", () => {
    it("near mint beats raw 'mint'", () => {
      // "near mint" and "mint" both trigger NM — same result. Just sanity.
      expect(parseConditionFromTitle("Charizard Near Mint base set")).toBe("NM");
    });

    it("damaged beats nothing-else", () => {
      // "damaged" is checked before LP/MP/HP/NM via the parser's order.
      expect(parseConditionFromTitle("Mew damaged corner LP edge")).toBe("DMG");
    });
  });
});

describe("titleFilter — name + disambiguator", () => {
  it("keeps listings that match name AND card number", () => {
    const items = [
      listing("Pokemon Charizard 4/102 Base Set Holo"),
      listing("Pikachu base set 58 holo"), // wrong card
    ];
    const result = titleFilter(items, "Charizard", "4", "Base Set");
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain("Charizard");
  });

  it("keeps listings that match name AND set name (even without number)", () => {
    const items = [
      listing("Charizard Base Set Unlimited Holo Rare"),
      listing("Charizard PSA 9"), // no disambiguator
    ];
    const result = titleFilter(items, "Charizard", null, "Base Set");
    expect(result).toHaveLength(1);
  });

  it("drops listings with the card name but neither set nor number", () => {
    const items = [listing("Random Charizard art print mint")];
    const result = titleFilter(items, "Charizard", "4", "Base Set");
    expect(result).toHaveLength(0);
  });

  it("fuzzy-matches a misspelled name (Levenshtein-1)", () => {
    // 'Charzard' missing the 'i' — should still pass our fuzzy filter.
    const items = [listing("Vintage Charzard 4/102 Base Set holo")];
    const result = titleFilter(items, "Charizard", "4", "Base Set");
    expect(result).toHaveLength(1);
  });

  it("does NOT fuzzy-match for short names (Mew stays strict)", () => {
    // Mew is 3 chars → fuzzMax=0; "Mewtwo" must NOT match "Mew".
    const items = [
      listing("Mewtwo Base Set 10 holo psa 9"),
      listing("Mew Celebrations 25 holo"),
    ];
    const result = titleFilter(items, "Mew", "25", "Celebrations");
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain("Mew Celebrations");
  });
});

describe("titleFilter — accessory blocklist", () => {
  it("drops display cases, sleeves, protectors, lighters, rugs", () => {
    const items = [
      listing("Charizard 4/102 base set holo card"),
      listing("Charizard 4 base set display case (no card)"),
      listing("Charizard 4 base set toploader sleeve"),
      listing("Charizard 4 base set 5x7 art frame"),
      listing("Charizard 4 base set wind resistant lighter"),
      listing("Charizard rug carpet 24x36"),
    ];
    const result = titleFilter(items, "Charizard", "4", "Base Set");
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Charizard 4/102 base set holo card");
  });

  it("drops slab inserts and graded-card art frames", () => {
    const items = [
      listing("Mew ex 232 Paldean Fates SIR holo card"),
      listing("Mew ex 232 PSA slab insert extended art"),
      listing("Mew ex 232 graded insert for CGC slab"),
      listing("Mew ex 232 art only no card included"),
    ];
    const result = titleFilter(items, "Mew ex", "232", "Paldean Fates");
    expect(result).toHaveLength(1);
  });
});

describe("titleFilter — card-number word boundaries", () => {
  it("'25' does NOT match '250' (regression: Fusion Strike 250)", () => {
    const items = [
      listing("Mew V Fusion Strike 250/264 Full Art"),
      listing("Mew Celebrations 25 holo"),
    ];
    // setName is null so only the number can disambiguate.
    const result = titleFilter(items, "Mew", "25", null);
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain("Celebrations");
  });

  it("'25' matches '25/25' (slash-suffixed)", () => {
    const items = [listing("Mew secret 025/025 celebrations gold")];
    const result = titleFilter(items, "Mew", "25", "Celebrations");
    expect(result).toHaveLength(1);
  });
});

describe("normaliseItem — listing kind detection (P5)", () => {
  function raw(over: Partial<EbayListingRaw> = {}): EbayListingRaw {
    return {
      itemId: "v1|abc|0",
      title: "Test card",
      buyingOptions: ["FIXED_PRICE"],
      itemWebUrl: "https://example.com",
      ...over,
    };
  }

  it("classifies BIN — only price, no AUCTION buying option", () => {
    const n = normaliseItem(
      raw({
        price: { value: "50.00", currency: "USD" },
        buyingOptions: ["FIXED_PRICE"],
      })
    );
    expect(n.kind).toBe("BIN");
    expect(n.listingPrice).toBe(50);
    expect(n.listingType).toBe("FIXED_PRICE");
  });

  it("classifies AUCTION_ONLY — no price, currentBidPrice + AUCTION buying option", () => {
    const n = normaliseItem(
      raw({
        price: undefined,
        currentBidPrice: { value: "12.50", currency: "USD" },
        buyingOptions: ["AUCTION"],
        bidCount: 3,
      })
    );
    expect(n.kind).toBe("AUCTION_ONLY");
    expect(n.listingPrice).toBe(12.5);
    expect(n.listingType).toBe("AUCTION");
    expect(n.bids).toBe(3);
  });

  it("classifies BIN_PLUS_AUCTION — price AND AUCTION buying option", () => {
    const n = normaliseItem(
      raw({
        price: { value: "75.00", currency: "USD" },
        currentBidPrice: { value: "20.00", currency: "USD" },
        buyingOptions: ["AUCTION", "FIXED_PRICE"],
      })
    );
    expect(n.kind).toBe("BIN_PLUS_AUCTION");
    // Reference price for scoring is the Buy It Now, not the bid.
    expect(n.listingPrice).toBe(75);
  });

  it("uses currentBidPrice when item.price is absent (no silent drop)", () => {
    // Regression: previously these listings were filtered out entirely.
    const n = normaliseItem(
      raw({
        price: undefined,
        currentBidPrice: { value: "8.00", currency: "USD" },
        buyingOptions: ["AUCTION"],
      })
    );
    expect(n.listingPrice).toBe(8);
    expect(n.kind).toBe("AUCTION_ONLY");
  });

  it("computes totalCost = listingPrice + shipping for pure auctions too", () => {
    const n = normaliseItem(
      raw({
        price: undefined,
        currentBidPrice: { value: "20.00", currency: "USD" },
        buyingOptions: ["AUCTION"],
        shippingOptions: [
          { shippingCost: { value: "4.50", currency: "USD" }, shippingCostType: "FIXED" },
        ],
      })
    );
    expect(n.shippingCost).toBe(4.5);
    expect(n.totalCost).toBe(24.5);
  });

  it("treats FREE / 0-cost shipping as null shippingCost", () => {
    const n = normaliseItem(
      raw({
        price: { value: "20.00", currency: "USD" },
        shippingOptions: [{ shippingCostType: "FREE" }],
      })
    );
    expect(n.shippingCost).toBeNull();
    expect(n.totalCost).toBe(20);
  });
});

describe("CONDITION_MULTIPLIER (regression locks on numbers)", () => {
  it.each([
    ["NM", 1.0],
    ["LP", 0.85],
    ["MP", 0.65],
    ["HP", 0.4],
    ["DMG", 0.25],
    ["GRADED", 1.5],
    ["UNKNOWN", 1.0],
  ] as const)("%s = %d×", (grade, expected) => {
    expect(CONDITION_MULTIPLIER[grade]).toBe(expected);
  });
});
