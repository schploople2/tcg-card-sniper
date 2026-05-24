/**
 * A2 — Mis-titled lot scoring.
 *
 * For a lot's freshly-OCR'd parsedCards list, compute the dollar value
 * of cards whose names don't appear anywhere in the lot title. The signal:
 * "this 'Pokemon card lot' listing hides a Base Charizard worth $300."
 *
 * Pure function — Prisma-free — so it's trivial to unit-test and reusable
 * outside the alert path (e.g. dashboard badge in a follow-up issue).
 */

import { tokeniseQuery } from "./savedLotSearches.js";

export interface MistitledScoreInput {
  title: string;
  /** Lot.parsedCards JSON shape (defensive — pass anything). */
  parsedCards: unknown;
}

export interface MistitledHiddenCard {
  name: string;
  quantity: number;
  /** Per-unit max market across candidates, in USD. */
  unitValue: number;
  /** unitValue × quantity. */
  totalValue: number;
}

export interface MistitledScoreResult {
  /** Total USD of cards in the photos that the title doesn't name. */
  hiddenUsd: number;
  /** Per-card breakdown of the hidden value, sorted desc by totalValue. */
  hidden: MistitledHiddenCard[];
}

interface MinimalCandidate {
  market?: unknown;
}
interface MinimalParsedCard {
  name?: unknown;
  quantity?: unknown;
  candidates?: unknown;
}

export function computeMistitledScore(input: MistitledScoreInput): MistitledScoreResult {
  const titleTokens = new Set(tokeniseQuery(input.title));
  if (titleTokens.size === 0) {
    return { hiddenUsd: 0, hidden: [] };
  }

  const parsed: MinimalParsedCard[] = Array.isArray(input.parsedCards)
    ? (input.parsedCards as MinimalParsedCard[])
    : [];

  const hidden: MistitledHiddenCard[] = [];
  for (const p of parsed) {
    if (typeof p.name !== "string" || p.name.trim().length === 0) continue;
    const name = p.name.trim();
    // A card is "hidden" if NONE of its name tokens appear in the title.
    // This is intentionally lenient — even a single matching token (e.g.
    // "Charizard" in a "Charizard lot" title) makes the card "named".
    const nameTokens = tokeniseQuery(name);
    if (nameTokens.length === 0) continue;
    const anyTokenInTitle = nameTokens.some((tok) => titleTokens.has(tok));
    if (anyTokenInTitle) continue;

    const cands: MinimalCandidate[] = Array.isArray(p.candidates)
      ? (p.candidates as MinimalCandidate[])
      : [];
    const unitValue = cands.reduce<number>((max, c) => {
      const v = typeof c.market === "number" && c.market > 0 ? c.market : 0;
      return v > max ? v : max;
    }, 0);
    if (unitValue <= 0) continue; // unpriceable cards don't contribute

    const qty =
      typeof p.quantity === "number" && p.quantity > 0 ? Math.floor(p.quantity) : 1;
    hidden.push({
      name,
      quantity: qty,
      unitValue,
      totalValue: unitValue * qty,
    });
  }

  hidden.sort((a, b) => b.totalValue - a.totalValue);
  const hiddenUsd = hidden.reduce((acc, h) => acc + h.totalValue, 0);

  return { hiddenUsd: Math.round(hiddenUsd * 100) / 100, hidden };
}
