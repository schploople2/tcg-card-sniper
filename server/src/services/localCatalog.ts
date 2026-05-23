import type { Card } from "@prisma/client";
import { prisma } from "../db.js";
import type { CatalogCard } from "./pokemontcg.js";

/**
 * Local-Postgres catalog search. Mirrors the precedence rules of the remote
 * pokemontcg.io search but runs against the `Card` table maintained by
 * `jobs/syncCatalog.ts`. Returns CatalogCard-shaped objects so callers don't
 * have to care whether they're hitting cache or live.
 *
 * Precedence (highest first, dedup by id, cap at pageSize):
 *   1. Known subset alias        — "radiant collection" → setId IN (...) AND number ILIKE 'RC%'
 *   2. Exact name (case-insensit) — name = 'Mew'
 *   3. Per-token prefix          — name ILIKE 'Sylveon%' AND name ILIKE '%EX%' (bridges hyphen)
 *   4. Set name prefix           — setName ILIKE 'Generations%'
 *   5. Name substring            — name ILIKE '%char%'
 *
 * Pricing fields (variantPrices, cardmarketPrices, previewMarket) come back
 * empty because we don't cache prices in `Card` (they live in PriceCache and
 * change daily). The Add Card flow re-fetches the chosen card from the
 * remote API to get fresh prices, so empty here is fine.
 */

const SUBSET_ALIASES: Array<{
  match: RegExp;
  setIds: string[];
  numberPrefix: string;
}> = [
  { match: /\bradiant\s*collection\b/i, setIds: ["bw11", "g1"], numberPrefix: "RC" },
  { match: /\btrainer\s*gallery\b/i, setIds: [], numberPrefix: "TG" },
  { match: /\bgalarian\s*gallery\b/i, setIds: ["swsh12pt5gg"], numberPrefix: "GG" },
  { match: /\bshiny\s*vault\b/i, setIds: ["sm115"], numberPrefix: "SV" },
];

/**
 * Pull the numeric portion out of a card-number string for natural sort.
 * Examples: "RC1" → 1, "RC10" → 10, "232/091" → 232, "TG12" → 12.
 * Returns Infinity for non-numeric strings so they sort to the back.
 */
function numericPart(numberStr: string): number {
  const m = numberStr.match(/\d+/);
  return m ? parseInt(m[0], 10) : Infinity;
}

function subsetFor(query: string) {
  for (const sub of SUBSET_ALIASES) {
    if (sub.match.test(query)) return sub;
  }
  return null;
}

function toCatalogCard(c: Card): CatalogCard {
  return {
    id: c.id,
    name: c.name,
    number: c.number,
    rarity: c.rarity,
    setId: c.setId,
    setName: c.setName,
    setSeries: c.setSeries,
    imageSmall: c.imageSmall,
    imageLarge: c.imageLarge,
    variants: c.variants,
    // Prices are intentionally absent from the local cache — the Add flow
    // fetches them fresh from pokemontcg.io. Browsing-only previews skip
    // the market hint, which is a worthwhile tradeoff for fast search.
    variantPrices: {},
    cardmarketPrices: null,
    previewMarket: null,
  };
}

/**
 * Run the local search. Returns null when the Card table is empty (e.g. on
 * first deploy before the sync job has run) so the caller can fall back to
 * remote. Returns [] (empty array) for valid queries that simply matched
 * nothing — the caller should NOT fall back in that case.
 */
export async function searchLocalCatalog(
  query: string,
  pageSize = 20
): Promise<CatalogCard[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Cold-cache guard: if the table is empty, return null so the caller can
  // fall through to the remote API rather than telling the user "no results".
  const sampleCount = await prisma.card.count({ take: 1 });
  if (sampleCount === 0) return null;

  const lower = trimmed.toLowerCase();
  const tokens = trimmed.split(/[\s-]+/).filter((t) => t.length > 0);
  const subset = subsetFor(trimmed);

  // Execute each query layer independently. We could squash these into one
  // mega-CASE-ranked query, but separate queries are easier to reason about
  // and each individually uses an index efficiently.
  const layers: Array<Promise<Card[]>> = [];

  // 1. Subset alias
  //
  // Sort: newest set first (setReleaseDate desc) so e.g. Generations (2016)
  // appears above Legendary Treasures (2013). Within a set, sort by the
  // numeric portion of `number` ASCENDING — users expect RC1 → RC32 order
  // when browsing a subset, not RC32 → RC1. Number is a String column ("RC1",
  // "RC10", "RC2") so we can't naively order by it (lexicographic gives
  // RC1, RC10, RC11, … RC2). Prisma's orderBy doesn't support SQL expressions,
  // so we over-fetch from the index and sort the small result set in JS below.
  if (subset) {
    layers.push(
      prisma.card
        .findMany({
          where: {
            ...(subset.setIds.length > 0 ? { setId: { in: subset.setIds } } : {}),
            number: { startsWith: subset.numberPrefix, mode: "insensitive" },
          },
          orderBy: [{ setReleaseDate: "desc" }],
          take: pageSize * 4,
        })
        .then((rows) =>
          rows
            .sort((a, b) => {
              // Primary: setReleaseDate desc (newest set first). The column
              // is a String (YYYY/MM/DD from pokemontcg.io), so lexicographic
              // compare is the same as chronological compare.
              const dateCmp = (b.setReleaseDate ?? "").localeCompare(
                a.setReleaseDate ?? ""
              );
              if (dateCmp !== 0) return dateCmp;
              // Secondary: numeric portion of `number` ascending (RC1 < RC10).
              return numericPart(a.number) - numericPart(b.number);
            })
            .slice(0, pageSize)
        )
    );
  }

  // 2. Exact name (case-insensitive)
  layers.push(
    prisma.card.findMany({
      where: { name: { equals: trimmed, mode: "insensitive" } },
      orderBy: [{ setReleaseDate: "desc" }, { number: "desc" }],
      take: pageSize,
    })
  );

  // 3. Per-token prefix AND — bridges Sylveon-EX vs Sylveon ex
  if (tokens.length > 1) {
    layers.push(
      prisma.card.findMany({
        where: {
          AND: tokens.map((t) => ({
            name: { contains: t, mode: "insensitive" as const },
          })),
        },
        orderBy: [{ setReleaseDate: "desc" }, { number: "desc" }],
        take: pageSize,
      })
    );
  }

  // 4. Set name prefix
  layers.push(
    prisma.card.findMany({
      where: { setName: { startsWith: trimmed, mode: "insensitive" } },
      orderBy: [{ setReleaseDate: "desc" }, { number: "desc" }],
      take: pageSize,
    })
  );

  // 5. Name substring (typeahead-style)
  layers.push(
    prisma.card.findMany({
      where: { name: { contains: lower, mode: "insensitive" } },
      orderBy: [{ setReleaseDate: "desc" }, { number: "desc" }],
      take: pageSize,
    })
  );

  const results = await Promise.all(layers);

  const seen = new Set<string>();
  const merged: Card[] = [];
  for (const layer of results) {
    for (const c of layer) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      merged.push(c);
      if (merged.length >= pageSize) break;
    }
    if (merged.length >= pageSize) break;
  }

  return merged.map(toCatalogCard);
}
