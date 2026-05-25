import type { BulkCounts } from "./lotVisionAi.js";

/**
 * A3 — Bulk-rarity valuation.
 *
 * Given a count of unidentified cards by rarity bucket, produce a
 * low/mid/high USD value band using industry-standard bulk rates.
 *
 * Rates come from the dealer/collector consensus on r/PokemonTCG and
 * PriceCharting's own "bulk" band:
 *   commons:   $0.01 – $0.05  (mid $0.02)
 *   uncommons: $0.05 – $0.15  (mid $0.08)
 *   rares:     $0.25 – $1.00  (mid $0.50)
 *   holos:     $1.00 – $3.00  (mid $1.50)
 *
 * Overridable via the rates argument so the analyzer modal can let a
 * user dial in their own dealer's rates without redeploying.
 */
export interface BulkRates {
  /** [low, mid, high] in USD per card */
  commons: [number, number, number];
  uncommons: [number, number, number];
  rares: [number, number, number];
  holos: [number, number, number];
}

export const DEFAULT_BULK_RATES: BulkRates = {
  commons: [0.01, 0.02, 0.05],
  uncommons: [0.05, 0.08, 0.15],
  rares: [0.25, 0.5, 1.0],
  holos: [1.0, 1.5, 3.0],
};

export interface BulkValuation {
  /** Sum of every bucket count — how many bulk cards we're valuing. */
  totalCards: number;
  /** Low estimate: every card priced at the bottom of its band. */
  low: number;
  /** Mid estimate: each card at the middle of its band. */
  mid: number;
  /** High estimate: every card at the top of its band. */
  high: number;
  /** Per-bucket mid-estimate contribution, for UI tooltips/breakdowns. */
  byBucket: {
    commons: number;
    uncommons: number;
    rares: number;
    holos: number;
  };
}

/** Round USD to two decimals — matches the rest of the app's money display. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Value a BulkCounts using the given rates. Returns zeros when totalCards
 * is 0 (so the UI can hide the bulk panel entirely when there's nothing
 * to show).
 */
export function valueBulk(
  counts: BulkCounts,
  rates: BulkRates = DEFAULT_BULK_RATES
): BulkValuation {
  const totalCards =
    counts.commons + counts.uncommons + counts.rares + counts.holos;

  const dotProduct = (
    n: number,
    [lo, mid, hi]: [number, number, number]
  ): { low: number; mid: number; high: number } => ({
    low: n * lo,
    mid: n * mid,
    high: n * hi,
  });

  const c = dotProduct(counts.commons, rates.commons);
  const u = dotProduct(counts.uncommons, rates.uncommons);
  const ra = dotProduct(counts.rares, rates.rares);
  const h = dotProduct(counts.holos, rates.holos);

  return {
    totalCards,
    low: r2(c.low + u.low + ra.low + h.low),
    mid: r2(c.mid + u.mid + ra.mid + h.mid),
    high: r2(c.high + u.high + ra.high + h.high),
    byBucket: {
      commons: r2(c.mid),
      uncommons: r2(u.mid),
      rares: r2(ra.mid),
      holos: r2(h.mid),
    },
  };
}
