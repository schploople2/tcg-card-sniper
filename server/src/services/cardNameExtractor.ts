import { prisma } from "../db.js";

/**
 * Extract candidate card names from an eBay lot title.
 *
 * Strategy: build a lowercased Aho-Corasick-flavoured trie from every
 * unique card name in the local `Card` table (~20k names, of which ~3k
 * are unique), then sweep the trie across the normalised title finding
 * every full name occurrence.
 *
 * Why a custom trie rather than `ahocorasick` from npm?
 *   - The dataset is small (~3k names, max ~30 chars each). A simple
 *     longest-prefix-match trie built once at boot and reused indefinitely
 *     is fast enough and avoids a supply-chain dep.
 *   - We want a *longest* match: "Mewtwo ex" should beat "Mewtwo" which
 *     should beat "Mew". The trie stores end-markers at every name length
 *     and we keep the longest one ending at each position.
 *
 * Quantity parsing happens here too because the quantity token usually
 * lives adjacent to the name in the title ("Charizard x3", "(3) Pikachu").
 *
 * Disambiguation (figuring out which printing the seller meant) lives in
 * lotValuation — this module just returns every printing of every name
 * it finds, leaving the ambiguity for the caller.
 */

// ─── Trie ─────────────────────────────────────────────────────────────────────

interface TrieNode {
  /** Lowercased character → child. */
  next: Map<string, TrieNode>;
  /** If non-null, this node is the END of a known card name (lowercased). */
  endsName: string | null;
}

/**
 * Build a fresh trie from every card name in the catalog.
 *
 * Names ≤3 chars are SKIPPED — they're way too noisy ("Mew" inside "Mewtwo",
 * "Hop" inside "Hoppip", arbitrary 3-letter substrings of titles). The
 * caller can still get short-named printings via direct id lookup.
 */
async function buildTrie(): Promise<TrieNode> {
  const root: TrieNode = { next: new Map(), endsName: null };

  // Distinct names only — we'll resolve to specific printings in valuation.
  const rows = await prisma.card.findMany({
    select: { name: true },
    distinct: ["name"],
  });

  for (const { name } of rows) {
    if (name.length < 4) continue;
    insert(root, name);
  }
  return root;
}

function insert(root: TrieNode, name: string): void {
  // Normalise to lowercase + collapse internal punctuation so "Sylveon-EX"
  // and "Sylveon EX" insert to the same path. Matches the same normalisation
  // we apply to titles at scan time.
  const norm = normalise(name);
  if (norm.length === 0) return;

  let cur = root;
  for (const ch of norm) {
    let next = cur.next.get(ch);
    if (!next) {
      next = { next: new Map(), endsName: null };
      cur.next.set(ch, next);
    }
    cur = next;
  }
  // If two different cards normalise to the same key, keep one — we'll
  // resolve all printings in valuation.
  if (cur.endsName === null) cur.endsName = norm;
}

/**
 * Normalise to lowercase ASCII with single spaces. Punctuation (`-`, `'`,
 * `:` etc.) becomes a space; accented chars are stripped to their NFKD base.
 *
 * This is the canonical "fuzzy equal" form for matching card names against
 * messy eBay titles.
 */
function normalise(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining marks (accents)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Module-level singleton ───────────────────────────────────────────────────

/**
 * Build the trie once per server boot and reuse it. ~3k names × ~12 chars
 * average = ~35k trie nodes ≈ a few MB. Negligible vs server RAM and a
 * 100% cache-hit rate after the first request.
 *
 * The promise is awaited the first time `extractCards` runs, then cached.
 */
let triePromise: Promise<TrieNode> | null = null;
function getTrie(): Promise<TrieNode> {
  if (!triePromise) triePromise = buildTrie();
  return triePromise;
}

/**
 * Reset the cached trie. Called by the catalog sync job after a fresh
 * pull so newly-released cards are recognised without restarting the server.
 */
export function invalidateNameTrie(): void {
  triePromise = null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ExtractedName {
  /** The canonical (lowercased) card name as it appears in the catalog. */
  name: string;
  /** Inferred quantity from the title, default 1. */
  quantity: number;
  /** 0..1 — higher means we're more confident this is intentional, not a coincidence. */
  confidence: number;
  /** Start / end positions in the normalised title (for debugging). */
  span: { start: number; end: number };
}

/**
 * Run the name trie across a title and return every (longest) match.
 *
 * Quantity parsing: looks for `(N)`, `x N`, `N x` adjacent to (or just
 * before) each match. Captures within ±15 normalised characters.
 *
 * Confidence:
 *   - 1.0  — name is followed by a card-shaped token ("ex", "v", "vmax",
 *            "gx") or a card number ("4/102", "RC32"). Strong signal.
 *   - 0.7  — name has explicit quantity adjacent (the user clearly listed it).
 *   - 0.5  — bare name match, no surrounding context.
 *
 * Names overlap by design — "Mewtwo ex" and "Mewtwo" both match the same
 * substring. We keep only the longest at each starting position to avoid
 * double-counting.
 */
export async function extractCards(title: string): Promise<ExtractedName[]> {
  const trie = await getTrie();
  const hay = normalise(title);

  const found: ExtractedName[] = [];
  for (let start = 0; start < hay.length; start++) {
    // Trie walk from this position, recording the LONGEST end-marker seen.
    let cur: TrieNode | undefined = trie;
    let lastMatchEnd = -1;
    let lastMatchName: string | null = null;

    for (let i = start; i < hay.length; i++) {
      cur = cur!.next.get(hay[i]);
      if (!cur) break;
      if (cur.endsName !== null) {
        lastMatchEnd = i + 1; // exclusive
        lastMatchName = cur.endsName;
      }
    }

    if (lastMatchName !== null) {
      // Require word boundaries at both ends: the matched span must start at
      // position 0 or after a space, and end at the title's end or before a
      // space. Without this, "Mew" matches inside "Mewtwo" / "Pokemon".
      const startBoundary = start === 0 || hay[start - 1] === " ";
      const endBoundary = lastMatchEnd === hay.length || hay[lastMatchEnd] === " ";
      if (!startBoundary || !endBoundary) continue;

      // Quantity sweep: ±15 chars around the match.
      const windowStart = Math.max(0, start - 15);
      const windowEnd = Math.min(hay.length, lastMatchEnd + 15);
      const window = hay.slice(windowStart, windowEnd);
      const quantity = parseQuantity(window) ?? 1;

      // Confidence sniff: do we see card-shaped context near the name?
      const confidence = scoreConfidence(window, quantity > 1);

      found.push({
        name: lastMatchName,
        quantity,
        confidence,
        span: { start, end: lastMatchEnd },
      });

      // Skip past this match so we don't re-find subnames inside it.
      start = lastMatchEnd - 1;
    }
  }

  return found;
}

/**
 * Adapter: convert externally-sourced card names (e.g. from vision-AI
 * output) into the `ExtractedName[]` shape used by the valuation pipeline.
 *
 * Skips names that don't appear in the local trie — those won't resolve
 * to any catalog Card row anyway, and surfacing them would clutter the
 * UI with un-priceable "unknown card" entries.
 *
 * Quantity / confidence come from the upstream source (vision model).
 * Span is reported as 0..0 since there's no title scan involved.
 */
export async function namesToExtracted(
  inputs: Array<{ name: string; quantity?: number; confidence?: number }>
): Promise<ExtractedName[]> {
  if (inputs.length === 0) return [];
  const trie = await getTrie();
  const out: ExtractedName[] = [];
  for (const input of inputs) {
    const norm = normalise(input.name);
    if (norm.length < 4) continue;
    // Walk the trie to confirm the full name exists in the catalog.
    let cur: TrieNode | undefined = trie;
    let endsName: string | null = null;
    for (const ch of norm) {
      cur = cur?.next.get(ch);
      if (!cur) break;
      if (cur.endsName !== null) endsName = cur.endsName;
    }
    // Only accept exact whole-name matches (the trie walk must consume
    // the entire input and end on an endsName node).
    if (!cur || cur.endsName !== norm) continue;
    out.push({
      name: endsName ?? norm,
      quantity: Math.max(1, Math.floor(input.quantity ?? 1)),
      confidence: Math.max(0, Math.min(1, input.confidence ?? 0.7)),
      span: { start: 0, end: 0 },
    });
  }
  return out;
}

const QUANTITY_PATTERNS = [
  /\bx\s*(\d{1,3})\b/i,
  /\b(\d{1,3})\s*x\b/i,
  /\((\d{1,3})\)/,
  /\bqty\s*[: ]?\s*(\d{1,3})\b/i,
];

function parseQuantity(window: string): number | null {
  for (const re of QUANTITY_PATTERNS) {
    const m = window.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 999) return n;
    }
  }
  return null;
}

const CARD_SHAPED_TOKENS = [
  // EX-era suffix words (always preceded by space in real card names)
  / ex\b/i,
  / gx\b/i,
  / vmax\b/i,
  / vstar\b/i,
  / \bv\b/i,
  // Card numbers / set codes
  /\b\d{1,3}\s*\/\s*\d{2,3}\b/, // "4/102", "232/091"
  /\bRC\d{1,2}\b/i,
  /\bTG\d{1,2}\b/i,
  /\bGG\d{1,2}\b/i,
];

function scoreConfidence(window: string, hasQuantity: boolean): number {
  for (const re of CARD_SHAPED_TOKENS) {
    if (re.test(window)) return 1.0;
  }
  if (hasQuantity) return 0.7;
  return 0.5;
}
