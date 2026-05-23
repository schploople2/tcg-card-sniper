/**
 * Misspelling-tolerant helpers used by the eBay search pipeline.
 *
 * Three exports:
 *   - levenshteinAtMost(a, b, max)    — bounded edit-distance; early-exits
 *     when distance exceeds `max`. Cheap enough to run per-title-per-token.
 *   - containsFuzzy(haystack, needle, maxDist)
 *                                     — sliding-window substring search
 *     allowing up to `maxDist` edits anywhere in the matched window.
 *   - noiseTermVariants(query)         — produces additional eBay query
 *     strings by swapping/dropping common noise words ("pokemon", "card",
 *     "holographic", "mint"). The card name itself is left intact.
 *
 * Why custom code and not e.g. `fastest-levenshtein`? The bounded variant
 * with early-exit is the bottleneck-relevant primitive and it's ~30 lines.
 * Avoiding a dep keeps the deploy image lean and avoids "supply-chain bytes
 * to read a typo" anxiety.
 */

// ─── Bounded Levenshtein ──────────────────────────────────────────────────────

/**
 * Returns the edit distance between `a` and `b` if it's ≤ `max`, otherwise
 * `max + 1`. The two-row DP table is O(min(|a|, |b|)) memory; the row-min
 * check lets us bail early when no remaining path can stay under `max`.
 *
 * Both inputs should already be lowercased; we don't do case folding here
 * (callers normalise once and reuse).
 */
export function levenshteinAtMost(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  // Ensure `a` is the shorter — keeps the row tiny when one input is long.
  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array<number>(a.length + 1);
  let curr = new Array<number>(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    let rowMin = curr[0];
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const v = Math.min(
        prev[i] + 1,        // deletion
        curr[i - 1] + 1,    // insertion
        prev[i - 1] + cost  // substitution
      );
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    // Even the best row entry exceeds max → no path can recover.
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

// ─── Sliding-window fuzzy substring ───────────────────────────────────────────

/**
 * Returns true when `needle` appears in `haystack` allowing up to `maxDist`
 * edits over a window of `needle.length` ± maxDist characters.
 *
 * Implementation: scan every aligned window in `haystack` of size
 * `needle.length ± maxDist`, computing bounded Levenshtein. Total work
 * is roughly O(|haystack| * |needle| * maxDist), which for a 60-char eBay
 * title and a 10-char card name with maxDist=2 is ~1.2 k ops per call —
 * cheap enough to run across the full 60-listing batch (~70 k ops total).
 *
 * Both inputs should be pre-normalised (lowercase, punctuation stripped).
 *
 * Returns true on the first window that matches. For tighter filtering
 * (require multi-token alignment, anchored matches, etc.), wrap this
 * primitive at the caller.
 */
export function containsFuzzy(
  haystack: string,
  needle: string,
  maxDist: number
): boolean {
  if (maxDist === 0) return haystack.includes(needle);
  if (needle.length === 0) return true;

  const nLen = needle.length;
  const minWin = Math.max(1, nLen - maxDist);
  const maxWin = nLen + maxDist;

  for (let start = 0; start + minWin <= haystack.length; start++) {
    // Try widening the window from min to max until we find a match.
    for (let win = minWin; win <= maxWin && start + win <= haystack.length; win++) {
      const slice = haystack.substr(start, win);
      if (levenshteinAtMost(slice, needle, maxDist) <= maxDist) return true;
    }
  }
  return false;
}

// ─── Noise-term variant queries ───────────────────────────────────────────────

/**
 * Common noise words sellers add to eBay titles and the misspellings we've
 * seen in the wild. Each entry maps a canonical term to a list of variants
 * a seller might type instead. The card name itself is *not* part of this
 * list — those are rarely misspelled (Charizard is iconic) and varying them
 * would cause false positives.
 *
 * Add to this map as observed misses surface in production logs.
 */
const NOISE_TERM_VARIANTS: Record<string, string[]> = {
  pokemon: ["pokimon", "pokeman", "pokémon", "pokmon"],
  pokmon: ["pokemon"],
  holographic: ["holographik", "holografic", "holographik"],
  holo: ["hollow", "hollo"],
  card: ["crd"],
  mint: ["mnt"],
  rare: ["rae"],
  ultra: ["ultar"],
};

/**
 * Given an eBay search query, produce up to 3 additional variants that
 * substitute or drop noise words. Caller dedupes ebayItemIds across the
 * canonical query and these variants.
 *
 * Empty result when the query contains no recognised noise terms (e.g. a
 * pure card-name search like `"Mew" 25 Celebrations` — no extra rounds).
 */
export function noiseTermVariants(query: string): string[] {
  const out: string[] = [];
  const lower = query.toLowerCase();

  for (const [canonical, variants] of Object.entries(NOISE_TERM_VARIANTS)) {
    if (!lower.includes(canonical)) continue;
    for (const v of variants) {
      // Word-boundary replace so "card" doesn't match "Charizard".
      const re = new RegExp(`\\b${canonical}\\b`, "gi");
      const swapped = query.replace(re, v);
      if (swapped !== query && !out.includes(swapped)) out.push(swapped);
      if (out.length >= 3) return out;
    }
  }

  return out;
}
