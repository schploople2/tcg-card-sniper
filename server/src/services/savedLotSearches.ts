import type { Lot, SavedLotSearch } from "@prisma/client";
import { prisma } from "../db.js";

/**
 * B4 — Saved-lot-search query matching.
 *
 * Given a Lot, find which users have a SavedLotSearch whose query matches
 * the lot's title AND whose filters (minLowEstimate / maxAskingPrice) pass.
 * Used by services/lotAlerts.ts to scope LOT_HOT alerts per-user instead
 * of firing globally.
 *
 * Query semantics (kept simple for v1):
 *   - Lowercase both sides.
 *   - Split the saved query on whitespace into tokens.
 *   - The lot title must contain every token as a substring (AND semantics).
 *   - Empty queries (shouldn't happen — UI requires non-empty) match nothing.
 *
 * Filter semantics:
 *   - minLowEstimate: if set, Lot.lowEstimate must be ≥ this value.
 *   - maxAskingPrice: if set, Lot.listingPrice must be ≤ this value.
 *   - Both null = no per-search filter; the global A1 thresholds still apply
 *     in evaluateLotAfterOcr (this is a *scoping* mechanism, not a *bypass*).
 */

export function tokeniseQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function matchesQuery(lotTitle: string, query: string): boolean {
  const tokens = tokeniseQuery(query);
  if (tokens.length === 0) return false;
  const title = lotTitle.toLowerCase();
  return tokens.every((tok) => title.includes(tok));
}

export function passesFilters(
  lot: Pick<Lot, "lowEstimate" | "listingPrice">,
  search: Pick<SavedLotSearch, "minLowEstimate" | "maxAskingPrice">
): boolean {
  const low = Number(lot.lowEstimate);
  const asking = Number(lot.listingPrice);
  if (search.minLowEstimate != null && low < Number(search.minLowEstimate)) {
    return false;
  }
  if (search.maxAskingPrice != null && asking > Number(search.maxAskingPrice)) {
    return false;
  }
  return true;
}

/**
 * Return the userIds whose at-least-one SavedLotSearch matches this lot
 * (query AND filters). Multiple searches per user collapse to a single
 * userId — A1 dedups alerts via the unique index anyway, so we don't
 * need to track which search fired the alert.
 */
export async function matchUsersForLot(
  lot: Pick<Lot, "title" | "lowEstimate" | "listingPrice">
): Promise<string[]> {
  // Pull every saved search. In practice this is small (single-digit
  // count per user, tens of users for the foreseeable future). When
  // scale demands we can move the tokenised match into Postgres with
  // tsvector + GIN — but that's premature for v1.
  const searches = await prisma.savedLotSearch.findMany({
    select: {
      userId: true,
      query: true,
      minLowEstimate: true,
      maxAskingPrice: true,
    },
  });
  const matched = new Set<string>();
  for (const s of searches) {
    if (matchesQuery(lot.title, s.query) && passesFilters(lot, s)) {
      matched.add(s.userId);
    }
  }
  return [...matched];
}
