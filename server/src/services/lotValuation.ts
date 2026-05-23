import type { DealTier } from "@prisma/client";
import { prisma } from "../db.js";
import type { ExtractedName } from "./cardNameExtractor.js";

/**
 * Take the names extracted from a lot title and value the bundle.
 *
 * For each name we surface EVERY printing in the local Card catalog as a
 * candidate. The lot's headline value is a RANGE, because "Pikachu" might
 * mean any of 30+ printings spanning $1–$500. We compute:
 *   - lowEstimate  = Σ (min market across candidates × quantity)
 *   - highEstimate = Σ (max market across candidates × quantity)
 *
 * lotScore uses lowEstimate so HOT only fires when EVEN the cheapest
 * interpretation beats the listing — conservative on purpose.
 *
 * Why not market price via `resolveMarketPrice` (the existing 4-tier
 * waterfall)? That function takes a single (cardName, variant) pair; lots
 * have N names × M printings. Calling it once per (name, printing) would
 * be slow and would need the variant for each printing. For v1 we use a
 * static-ish "best market price we have cached locally" — pulled directly
 * from PriceCache where it exists, fallback to TCGPlayer prices stored
 * on the Card row (when we add that column) or cardmarket trend.
 *
 * For v1 we use a simpler proxy: query PriceCache by pokemonTcgId and pull
 * the highest non-null market across any variant. That's the price the
 * "headline" version of the card commands, which is what a lot buyer cares
 * about. Cards with no PriceCache row are quietly skipped — they don't
 * contribute to either estimate.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CandidatePrinting {
  cardId: string; // pokemontcg.io id
  setName: string;
  setReleaseDate: string | null;
  number: string;
  market: number | null;
  currency: string;
}

export interface ParsedLotCard {
  name: string;
  quantity: number;
  confidence: number;
  candidates: CandidatePrinting[];
}

export interface LotValuation {
  parsedCards: ParsedLotCard[];
  lowEstimate: number;
  highEstimate: number;
  /** How many extracted names resolved to ≥1 priced candidate. */
  pricedNameCount: number;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve printings + value the lot.
 *
 * For each extracted name we query every Card row with that exact name,
 * then bulk-look-up PriceCache to find a market price. Cards without a
 * PriceCache row stay in the candidates list (UI shows them as "—") but
 * contribute 0 to the estimate.
 */
export async function valueLot(
  extracted: ExtractedName[]
): Promise<LotValuation> {
  if (extracted.length === 0) {
    return { parsedCards: [], lowEstimate: 0, highEstimate: 0, pricedNameCount: 0 };
  }

  // Pull every Card row matching any extracted name in one query. The Card
  // rows already carry `tcgplayerPrices` and `cardmarketPrices` thanks to
  // the catalog sync (populated weekly) — no PriceCache join needed.
  const names = [...new Set(extracted.map((e) => e.name))];
  const cards = await prisma.card.findMany({
    where: { name: { in: names, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      number: true,
      setName: true,
      setReleaseDate: true,
      tcgplayerPrices: true,
      cardmarketPrices: true,
    },
  });

  // Bucket cards by their lowercased name so the per-name loop below can
  // look up its candidates in O(1).
  const cardsByName = new Map<string, typeof cards>();
  for (const c of cards) {
    const key = c.name.toLowerCase();
    const bucket = cardsByName.get(key) ?? [];
    bucket.push(c);
    cardsByName.set(key, bucket);
  }

  let lowEstimate = 0;
  let highEstimate = 0;
  let pricedNameCount = 0;

  const parsedCards: ParsedLotCard[] = extracted.map((e) => {
    const fullBucket = cardsByName.get(e.name.toLowerCase()) ?? [];
    // Soft filter: when the upstream source (vision-AI) supplied a setHint
    // and/or cardNumber, prefer candidates that match. If filtering empties
    // the list we fall back to the unfiltered bucket — better a wide list
    // than no candidates at all when the hint is slightly off.
    const bucket = applyHints(fullBucket, e.setHint, e.cardNumber);

    const candidates: CandidatePrinting[] = bucket.map((c) => {
      const { market, currency } = pickBestMarket({
        variants: c.tcgplayerPrices,
        cardmarketPrices: c.cardmarketPrices,
      });
      return {
        cardId: c.id,
        setName: c.setName,
        setReleaseDate: c.setReleaseDate,
        number: c.number,
        market,
        currency,
      };
    });

    const prices = candidates.map((c) => c.market).filter((m): m is number => m != null);
    if (prices.length > 0) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      lowEstimate += min * e.quantity;
      highEstimate += max * e.quantity;
      pricedNameCount += 1;
    }

    return {
      name: e.name,
      quantity: e.quantity,
      confidence: e.confidence,
      candidates,
    };
  });

  return {
    parsedCards,
    lowEstimate: round(lowEstimate),
    highEstimate: round(highEstimate),
    pricedNameCount,
  };
}

/**
 * Score and tier the lot using the same thresholds as single-card listings
 * so the UI can reuse DEAL_TIER_CONFIG without translation.
 *
 * Returns UNSCORED when lowEstimate is 0 (we parsed names but none had
 * usable prices). UI surfaces these for browsing without a deal claim.
 */
export function scoreLot(
  totalCost: number,
  lowEstimate: number
): { lotScore: number; lotTier: DealTier } {
  if (lowEstimate <= 0) {
    return { lotScore: 0, lotTier: "UNSCORED" };
  }
  const score = Math.round(((lowEstimate - totalCost) / lowEstimate) * 100);
  let tier: DealTier;
  if (score > 25) tier = "HOT";
  else if (score > 10) tier = "GOOD";
  else if (score >= 0) tier = "FAIR";
  else tier = "OVER";
  return { lotScore: score, lotTier: tier };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface TcgPlayerVariants {
  [variant: string]: { market?: number | null } | undefined;
}
interface CardmarketShape {
  trendPrice?: number | null;
  averageSellPrice?: number | null;
}

/**
 * Pick the best available market price for a card. Preference order:
 *   1. TCGPlayer market (USD) — most accurate for US eBay sellers.
 *      Among variants, pick the highest market — "headline" version.
 *   2. Cardmarket trendPrice (EUR) — fallback for alt-arts.
 *
 * Returns null when neither has data. Currency is reported so the UI can
 * label the chip.
 */
function pickBestMarket(
  row: { variants: unknown; cardmarketPrices: unknown } | undefined
): { market: number | null; currency: string } {
  if (!row) return { market: null, currency: "USD" };

  const variants = row.variants as TcgPlayerVariants | null;
  if (variants && typeof variants === "object") {
    const prices = Object.values(variants)
      .map((v) => v?.market ?? null)
      .filter((m): m is number => m != null && m > 0);
    if (prices.length > 0) return { market: Math.max(...prices), currency: "USD" };
  }

  const cm = row.cardmarketPrices as CardmarketShape | null;
  if (cm && typeof cm === "object") {
    const m = cm.trendPrice ?? cm.averageSellPrice ?? null;
    if (m && m > 0) return { market: m, currency: "EUR" };
  }

  return { market: null, currency: "USD" };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Merge a Lot's title-extracted `parsedCards` JSON with a set of vision-AI
 * suggestions, producing the input shape `namesToExtracted` consumes.
 *
 * Rule: union by lowercased name. When the same card appears in both, the
 * vision reading wins on quantity / confidence and contributes the hints —
 * the title already proved the card was mentioned; vision is more
 * informative about how many and which printing.
 *
 * Pure function, so we can unit-test it without a Prisma mock.
 */
export interface VisionMergeInput {
  name: string;
  quantity: number;
  confidence: number;
  setHint?: string | null;
  cardNumber?: string | null;
}
export interface MergedForRevaluation {
  name: string;
  quantity: number;
  confidence: number;
  setHint: string | null;
  cardNumber: string | null;
}
export function mergeTitleAndVisionParsed(
  titleParsedJson: unknown,
  vision: VisionMergeInput[]
): MergedForRevaluation[] {
  interface MinimalParsed {
    name?: unknown;
    quantity?: unknown;
    confidence?: unknown;
  }
  const titleParsed: MinimalParsed[] = Array.isArray(titleParsedJson)
    ? (titleParsedJson as MinimalParsed[])
    : [];

  const byName = new Map<string, MergedForRevaluation>();
  for (const t of titleParsed) {
    if (typeof t.name !== "string") continue;
    byName.set(t.name.toLowerCase(), {
      name: t.name,
      quantity: typeof t.quantity === "number" && t.quantity >= 1 ? t.quantity : 1,
      confidence: typeof t.confidence === "number" ? t.confidence : 0.5,
      setHint: null,
      cardNumber: null,
    });
  }
  for (const v of vision) {
    const key = v.name.toLowerCase();
    const existing = byName.get(key);
    byName.set(key, {
      name: v.name,
      quantity: Math.max(existing?.quantity ?? 0, v.quantity),
      confidence: Math.max(existing?.confidence ?? 0, v.confidence),
      setHint: v.setHint ?? existing?.setHint ?? null,
      cardNumber: v.cardNumber ?? existing?.cardNumber ?? null,
    });
  }
  return [...byName.values()];
}

interface CardForHint {
  number: string;
  setName: string;
}

/**
 * Narrow a candidate bucket using optional set / number hints from vision-AI.
 *
 * cardNumber compares exactly against `Card.number`. Vision often returns
 * "4/102"-style numerator-over-denominator; we strip the denominator before
 * comparing so "4/102" matches a card with number "4". Both raw and stripped
 * forms are tried.
 *
 * setHint uses case-insensitive forward substring containment — the catalog
 * set name must contain the hint. Vision-AI is generally verbose enough to
 * use full set names, and forward-only avoids "Base Set" matching the more
 * specific "Base Set 2".
 *
 * Both filters apply additively when both are present. If the combined
 * filter empties the bucket we fall back to the unfiltered bucket (soft
 * filter) so a slightly-off hint doesn't drop the card entirely.
 */
export function applyHints<T extends CardForHint>(
  bucket: T[],
  setHint: string | null | undefined,
  cardNumber: string | null | undefined
): T[] {
  if (bucket.length === 0) return bucket;
  if (!setHint && !cardNumber) return bucket;

  const numStripped = cardNumber ? cardNumber.split("/")[0].trim() : null;
  const hint = setHint ? setHint.trim().toLowerCase() : null;

  const filtered = bucket.filter((c) => {
    let ok = true;
    if (numStripped) {
      ok = ok && (c.number === cardNumber || c.number === numStripped);
    }
    if (hint) {
      ok = ok && c.setName.toLowerCase().includes(hint);
    }
    return ok;
  });

  return filtered.length > 0 ? filtered : bucket;
}
