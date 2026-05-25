import { describe, it, expect } from "vitest";
import {
  valueBulk,
  DEFAULT_BULK_RATES,
  type BulkRates,
} from "../bulkValuation.js";

describe("valueBulk", () => {
  it("returns all zeros for empty counts", () => {
    const v = valueBulk({ commons: 0, uncommons: 0, rares: 0, holos: 0 });
    expect(v.totalCards).toBe(0);
    expect(v.low).toBe(0);
    expect(v.mid).toBe(0);
    expect(v.high).toBe(0);
    expect(v.byBucket).toEqual({ commons: 0, uncommons: 0, rares: 0, holos: 0 });
  });

  it("computes the simple single-bucket case (commons only)", () => {
    const v = valueBulk({ commons: 50, uncommons: 0, rares: 0, holos: 0 });
    expect(v.totalCards).toBe(50);
    // commons rate is [0.01, 0.02, 0.05]
    expect(v.low).toBe(0.5);
    expect(v.mid).toBe(1.0);
    expect(v.high).toBe(2.5);
  });

  it("sums across buckets correctly", () => {
    const v = valueBulk({ commons: 10, uncommons: 10, rares: 4, holos: 2 });
    expect(v.totalCards).toBe(26);
    // low  = 10(.01) + 10(.05) + 4(.25) + 2(1.00) = .10 + .50 + 1.00 + 2.00 = 3.60
    // mid  = 10(.02) + 10(.08) + 4(.50) + 2(1.50) = .20 + .80 + 2.00 + 3.00 = 6.00
    // high = 10(.05) + 10(.15) + 4(1.0) + 2(3.00) = .50 + 1.50 + 4.00 + 6.00 = 12.00
    expect(v.low).toBe(3.6);
    expect(v.mid).toBe(6.0);
    expect(v.high).toBe(12.0);
  });

  it("byBucket reports per-rarity mid contribution for UI breakdowns", () => {
    const v = valueBulk({ commons: 0, uncommons: 0, rares: 4, holos: 2 });
    // rares mid = 4 * .50 = 2.00, holos mid = 2 * 1.50 = 3.00
    expect(v.byBucket.commons).toBe(0);
    expect(v.byBucket.uncommons).toBe(0);
    expect(v.byBucket.rares).toBe(2.0);
    expect(v.byBucket.holos).toBe(3.0);
  });

  it("rounds USD to two decimal places", () => {
    // 3 holos at $1.50 each = $4.50 mid (clean)
    const v = valueBulk({ commons: 7, uncommons: 0, rares: 0, holos: 0 });
    // 7 * .02 = .14 mid — exact two-decimal
    expect(v.mid).toBe(0.14);
  });

  it("honours an overridden rate table", () => {
    const custom: BulkRates = {
      commons: [0.0, 0.1, 0.2],
      uncommons: [0.0, 0.0, 0.0],
      rares: [0.0, 0.0, 0.0],
      holos: [0.0, 0.0, 0.0],
    };
    const v = valueBulk({ commons: 10, uncommons: 5, rares: 5, holos: 5 }, custom);
    // Only commons price out under the custom table
    expect(v.mid).toBe(1.0);
    expect(v.high).toBe(2.0);
  });

  it("uses the DEFAULT_BULK_RATES export when no rates passed", () => {
    const a = valueBulk({ commons: 1, uncommons: 0, rares: 0, holos: 0 });
    const b = valueBulk(
      { commons: 1, uncommons: 0, rares: 0, holos: 0 },
      DEFAULT_BULK_RATES
    );
    expect(a).toEqual(b);
  });
});
