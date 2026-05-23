/**
 * Decide whether an eBay listing title looks like a multi-card lot.
 *
 * Three signals, any one is sufficient:
 *   1. Explicit lot keyword: "lot", "bulk", "collection", "bundle",
 *      "set of", "mystery pack" (and a few others sellers use).
 *   2. Explicit count: "10 cards", "x50", "(20)", "100 ct", "50pcs" etc.
 *   3. Multi-card density: ≥3 different card-name candidates separated by
 *      commas, plus signs, slashes, ampersands. We don't enumerate names
 *      here (that's the extractor's job in Pb.2) — just detect the shape.
 *
 * `isLotShaped(title)` is the fast O(|title|) check; the heavy
 * card-name extraction only runs on titles that pass.
 *
 * False positives are cheap (the extractor will return 0-card lots that we
 * gracefully skip downstream); false negatives are worse because we'd miss
 * value. When in doubt, err toward "this looks like a lot".
 */

const LOT_KEYWORDS = [
  "lot",
  "lots",
  "bulk",
  "collection",
  "bundle",
  "set of",
  "mystery pack",
  "mystery box",
  "binder",
  "booster bundle",
  // Card-count phrases that imply multiple
  "card lot",
  "cards lot",
];

/** Regex to spot count markers like "(20)", "10 cards", "x50", "100 ct". */
const COUNT_PATTERNS = [
  /\b(\d{2,4})\s*cards?\b/i,
  /\b(\d{1,3})\s*(?:pcs|count|ct)\b/i,
  /\bx\s*(\d{2,4})\b/i,
  /\((\d{2,4})\)/, // "(50)"
];

/**
 * Cheap separator density check — 3+ comma/plus/slash separations imply a
 * list of distinct items. Doesn't mean they're all cards (could be set
 * names listed), but a strong signal worth routing into the extractor.
 */
const LIST_SEPARATORS_RE = /[,\+\&\|]|\s\/\s|\sand\s/gi;

export interface LotShapeSignals {
  /** True iff at least one of the heuristics fired. */
  isLot: boolean;
  /** Which heuristic(s) tripped — useful for debugging false positives. */
  reasons: string[];
  /** Parsed explicit count, when one was found (e.g. "x50" → 50). */
  explicitCount: number | null;
}

export function detectLotShape(title: string): LotShapeSignals {
  const reasons: string[] = [];
  const lower = title.toLowerCase();

  // 1. Keyword match — guard with word boundaries so "lot" inside "Lott" or
  //    "allotment" doesn't trigger. (\b in JS regex is unicode-naive but
  //    the words we care about are all ASCII.)
  for (const kw of LOT_KEYWORDS) {
    // Multi-word keywords need a separate substring check (regex \b doesn't
    // help when the keyword itself contains spaces).
    const matches = kw.includes(" ")
      ? lower.includes(kw)
      : new RegExp(`\\b${kw}\\b`).test(lower);
    if (matches) {
      reasons.push(`keyword:${kw}`);
      break; // one keyword is enough; don't spam reasons
    }
  }

  // 2. Explicit count
  let explicitCount: number | null = null;
  for (const re of COUNT_PATTERNS) {
    const m = title.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      // "x2" is just a quantity for a single card; require ≥5 to count as a
      // lot signal. "(3)" is the same. Tune up if false positives leak.
      if (n >= 5) {
        explicitCount = n;
        reasons.push(`count:${n}`);
      }
      break;
    }
  }

  // 3. List-separator density. We count separators, not character matches,
  //    so "Charizard, Pikachu, Mew" → 2 separators → ≥2 cards implied.
  const sepCount = (title.match(LIST_SEPARATORS_RE) ?? []).length;
  if (sepCount >= 3) {
    reasons.push(`separators:${sepCount}`);
  }

  return {
    isLot: reasons.length > 0,
    reasons,
    explicitCount,
  };
}
