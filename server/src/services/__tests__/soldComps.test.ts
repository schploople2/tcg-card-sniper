import { describe, it, expect } from "vitest";
import {
  normaliseCondition,
  extractGradeLabel,
  mapFindingItem,
  summariseSoldComps,
  summariseByGrade,
  type SoldCompRow,
} from "../soldComps.js";

describe("normaliseCondition", () => {
  it("maps PSA/BGS/CGC text to GRADED", () => {
    expect(normaliseCondition("PSA 9 Mint")).toBe("GRADED");
    expect(normaliseCondition("BGS 9.5 Gem Mint")).toBe("GRADED");
    expect(normaliseCondition("CGC 10")).toBe("GRADED");
  });
  it("maps brand new / mint to NM", () => {
    expect(normaliseCondition("Brand New")).toBe("NM");
    expect(normaliseCondition("Near Mint")).toBe("NM");
  });
  it("maps the played tiers", () => {
    expect(normaliseCondition("Lightly Played")).toBe("LP");
    expect(normaliseCondition("Moderately Played")).toBe("MP");
    expect(normaliseCondition("Heavily Played")).toBe("HP");
    expect(normaliseCondition("Damaged")).toBe("DMG");
  });
  it("returns null for ambiguous 'Pre-Owned' / 'Used'", () => {
    expect(normaliseCondition("Pre-Owned")).toBe(null);
    expect(normaliseCondition("Used")).toBe(null);
  });
});

describe("mapFindingItem", () => {
  /**
   * Finding API wraps every leaf in a single-element array — these
   * fixtures mirror the real response shape exactly so the defensive
   * accessor `fa()` is exercised the way it runs in prod.
   */
  function baseItem(over: Record<string, unknown> = {}) {
    return {
      itemId: ["123456789012"],
      title: ["Pikachu V Full Art 188/185 NM"],
      viewItemURL: ["https://www.ebay.com/itm/123456789012"],
      galleryURL: ["https://i.ebayimg.com/img.jpg"],
      sellingStatus: [
        {
          currentPrice: [{ "@currencyId": "USD", __value__: "85.00" }],
          convertedCurrentPrice: [{ "@currencyId": "USD", __value__: "85.00" }],
          sellingState: ["EndedWithSales"],
        },
      ],
      shippingInfo: [
        {
          shippingServiceCost: [{ "@currencyId": "USD", __value__: "4.95" }],
          shippingType: ["Flat"],
        },
      ],
      condition: [{ conditionDisplayName: ["Near Mint"] }],
      listingInfo: [
        {
          endTime: ["2026-05-14T18:23:00.000Z"],
          bestOfferEnabled: ["false"],
          listingType: ["FixedPrice"],
        },
      ],
      ...over,
    };
  }

  it("maps the typical happy-path item shape", () => {
    const row = mapFindingItem(baseItem());
    expect(row).toMatchObject({
      ebayItemId: "123456789012",
      title: "Pikachu V Full Art 188/185 NM",
      soldPrice: 85,
      shippingCost: 4.95,
      totalPrice: 89.95,
      conditionGrade: "NM",
      acceptedOffer: false,
      ebayUrl: "https://www.ebay.com/itm/123456789012",
    });
    expect(row?.soldAt).toBeInstanceOf(Date);
    expect(row?.imageUrl).toBe("https://i.ebayimg.com/img.jpg");
  });

  it("treats 'Free' shippingType as $0 shipping", () => {
    const row = mapFindingItem(
      baseItem({
        shippingInfo: [{ shippingType: ["Free"] }],
      })
    );
    expect(row?.shippingCost).toBe(0);
    expect(row?.totalPrice).toBe(85);
  });

  it("falls back to currentPrice when convertedCurrentPrice is absent", () => {
    const row = mapFindingItem(
      baseItem({
        sellingStatus: [
          {
            currentPrice: [{ "@currencyId": "USD", __value__: "42.00" }],
            sellingState: ["EndedWithSales"],
          },
        ],
      })
    );
    expect(row?.soldPrice).toBe(42);
  });

  it("returns null when itemId is missing", () => {
    expect(mapFindingItem(baseItem({ itemId: undefined }))).toBe(null);
  });

  it("returns null when price is missing or non-numeric", () => {
    expect(mapFindingItem(baseItem({ sellingStatus: undefined }))).toBe(null);
    expect(
      mapFindingItem(
        baseItem({
          sellingStatus: [
            { currentPrice: [{ __value__: "not-a-number" }] },
          ],
        })
      )
    ).toBe(null);
  });

  it("maps PSA condition through to GRADED", () => {
    const row = mapFindingItem(
      baseItem({ condition: [{ conditionDisplayName: ["PSA 10 Gem Mint"] }] })
    );
    expect(row?.conditionGrade).toBe("GRADED");
  });

  it("uses now() when endTime is missing or unparseable", () => {
    const row = mapFindingItem(baseItem({ listingInfo: undefined }));
    expect(row?.soldAt).toBeInstanceOf(Date);
    const ageMs = Date.now() - row!.soldAt.getTime();
    expect(ageMs).toBeLessThan(5_000);
  });
});

describe("summariseSoldComps", () => {
  function row(price: number, daysAgo = 1): SoldCompRow {
    return {
      ebayItemId: `id-${price}`,
      title: "t",
      soldPrice: price,
      shippingCost: 0,
      totalPrice: price,
      conditionGrade: "NM",
      gradeLabel: null,
      acceptedOffer: false,
      soldAt: new Date(Date.now() - daysAgo * 86400_000),
      imageUrl: null,
      ebayUrl: "x",
    };
  }

  it("returns nulls for an empty set", () => {
    expect(summariseSoldComps([])).toEqual({
      count: 0,
      median: null,
      low: null,
      high: null,
      mostRecentAt: null,
    });
  });

  it("computes median for odd count", () => {
    const s = summariseSoldComps([row(10), row(20), row(30)]);
    expect(s.median).toBe(20);
    expect(s.low).toBe(10);
    expect(s.high).toBe(30);
    expect(s.count).toBe(3);
  });

  it("computes median for even count as the mid average", () => {
    const s = summariseSoldComps([row(10), row(20), row(30), row(50)]);
    expect(s.median).toBe(25);
  });

  it("picks the most recent soldAt across rows", () => {
    const s = summariseSoldComps([row(10, 30), row(20, 1), row(30, 90)]);
    const ageDays = (Date.now() - new Date(s.mostRecentAt!).getTime()) / 86400_000;
    expect(ageDays).toBeLessThan(2);
  });
});

describe("extractGradeLabel (C2)", () => {
  it("extracts PSA + score with space", () => {
    expect(extractGradeLabel("Charizard PSA 10 Gem Mint")).toBe("PSA 10");
    expect(extractGradeLabel("Mewtwo psa 9")).toBe("PSA 9");
  });

  it("extracts grader without space (PSA10)", () => {
    expect(extractGradeLabel("Pikachu PSA10 1999")).toBe("PSA 10");
  });

  it("extracts BGS half-grade", () => {
    expect(extractGradeLabel("Charizard BGS 9.5")).toBe("BGS 9.5");
    expect(extractGradeLabel("Blastoise bgs 8.5 gem")).toBe("BGS 8.5");
  });

  it("extracts CGC / SGC / ACE / GMA", () => {
    expect(extractGradeLabel("Mew CGC 10")).toBe("CGC 10");
    expect(extractGradeLabel("Rayquaza SGC 9")).toBe("SGC 9");
    expect(extractGradeLabel("Lugia ACE 10 mint")).toBe("ACE 10");
    expect(extractGradeLabel("Lapras GMA 8")).toBe("GMA 8");
  });

  it("returns null when no grader+score combo present", () => {
    expect(extractGradeLabel("Pikachu Holo 1999")).toBe(null);
    expect(extractGradeLabel("PSA holder authentic")).toBe(null); // no score
    expect(extractGradeLabel("BGS pristine")).toBe(null);
    expect(extractGradeLabel("")).toBe(null);
    expect(extractGradeLabel(null)).toBe(null);
    expect(extractGradeLabel(undefined)).toBe(null);
  });

  it("does not match score-without-grader (year numbers, set numbers)", () => {
    expect(extractGradeLabel("Charizard 1999 base 4/102")).toBe(null);
    expect(extractGradeLabel("Mewtwo holo 10 stamp")).toBe(null);
  });

  it("uppercases the grader for canonical form", () => {
    // Two different cases of input → same canonical output
    expect(extractGradeLabel("Charizard psa 10")).toBe(extractGradeLabel("Charizard PSA 10"));
  });

  it("takes the FIRST match when multiple appear", () => {
    expect(
      extractGradeLabel("Comparison: PSA 9 vs BGS 9.5 — your choice")
    ).toBe("PSA 9");
  });
});

describe("summariseByGrade (C2)", () => {
  function gradedRow(price: number, gradeLabel: string | null, daysAgo = 1): SoldCompRow {
    return {
      ebayItemId: `id-${price}-${gradeLabel ?? "raw"}`,
      title: gradeLabel ?? "raw",
      soldPrice: price,
      shippingCost: 0,
      totalPrice: price,
      conditionGrade: gradeLabel ? "GRADED" : "NM",
      gradeLabel,
      acceptedOffer: false,
      soldAt: new Date(Date.now() - daysAgo * 86400_000),
      imageUrl: null,
      ebayUrl: "x",
    };
  }

  it("returns [] for an empty input", () => {
    expect(summariseByGrade([])).toEqual([]);
  });

  it("returns [] when no rows carry a gradeLabel (all raw)", () => {
    expect(
      summariseByGrade([gradedRow(50, null), gradedRow(60, null)])
    ).toEqual([]);
  });

  it("groups by gradeLabel and computes per-grade median", () => {
    const out = summariseByGrade([
      gradedRow(380, "PSA 10"),
      gradedRow(420, "PSA 10"),
      gradedRow(460, "PSA 10"),
      gradedRow(150, "PSA 9"),
      gradedRow(180, "PSA 9"),
      gradedRow(70, null), // raw — skipped
    ]);
    expect(out).toHaveLength(2);
    const psa10 = out.find((g) => g.gradeLabel === "PSA 10")!;
    expect(psa10.count).toBe(3);
    expect(psa10.median).toBe(420);
    expect(psa10.low).toBe(380);
    expect(psa10.high).toBe(460);

    const psa9 = out.find((g) => g.gradeLabel === "PSA 9")!;
    expect(psa9.count).toBe(2);
    expect(psa9.median).toBe(165); // mean of 150 + 180
  });

  it("sorts output by median desc (most valuable first)", () => {
    const out = summariseByGrade([
      gradedRow(50, "PSA 8"),
      gradedRow(400, "PSA 10"),
      gradedRow(150, "PSA 9"),
    ]);
    expect(out.map((g) => g.gradeLabel)).toEqual(["PSA 10", "PSA 9", "PSA 8"]);
  });

  it("picks most-recent soldAt per grade", () => {
    const out = summariseByGrade([
      gradedRow(400, "PSA 10", 30),
      gradedRow(420, "PSA 10", 1),
      gradedRow(380, "PSA 10", 60),
    ]);
    const ageDays =
      (Date.now() - new Date(out[0].mostRecentAt).getTime()) / 86400_000;
    expect(ageDays).toBeLessThan(2);
  });

  it("rounds median to 2 decimal places", () => {
    const out = summariseByGrade([
      gradedRow(10, "PSA 10"),
      gradedRow(15, "PSA 10"),
      gradedRow(20, "PSA 10"),
    ]);
    expect(out[0].median).toBe(15);
    expect(Number.isInteger(out[0].median * 100)).toBe(true);
  });
});
