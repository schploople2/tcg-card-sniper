import cron from "node-cron";
import { prisma } from "../db.js";
import { searchEbayLots } from "../services/ebay.js";

/**
 * B4 — hourly :45 cron that re-runs each SavedLotSearch's query against
 * eBay so new matching lots land in the Lot table. The A4 :15 sweep then
 * OCRs any never-OCR'd ones, A1's evaluator fires LOT_HOT to the matched
 * users (scoped by SavedLotSearch via matchUsersForLot), B1's Discord
 * fan-out delivers — full pipeline.
 *
 * Notes on shape:
 *   - Iterates every saved search across all users (not per-user) so the
 *     same query saved by N users only hits eBay once. Dedup is implicit
 *     in the Lot upsert.
 *   - searchEbayLots already does the heavy lift: hits the Browse API,
 *     scores lots, upserts Lot rows. We just need to drive it.
 *   - Bumps SavedLotSearch.lastEvaluatedAt after each search so the
 *     /settings UI can show "last checked X minutes ago".
 */

interface RefreshResult {
  searchesProcessed: number;
  errors: number;
}

export async function runSavedSearchRefresh(): Promise<RefreshResult> {
  const searches = await prisma.savedLotSearch.findMany({
    select: { id: true, query: true },
  });
  // Dedup by query — same query saved by multiple users only hits eBay once.
  const byQuery = new Map<string, string[]>();
  for (const s of searches) {
    const key = s.query.toLowerCase().trim();
    const arr = byQuery.get(key) ?? [];
    arr.push(s.id);
    byQuery.set(key, arr);
  }
  if (byQuery.size === 0) {
    return { searchesProcessed: 0, errors: 0 };
  }

  let errors = 0;
  for (const [query, savedIds] of byQuery) {
    try {
      console.log(`[savedSearchRefresh] running "${query}"`);
      await searchEbayLots(query);
      await prisma.savedLotSearch.updateMany({
        where: { id: { in: savedIds } },
        data: { lastEvaluatedAt: new Date() },
      });
    } catch (err) {
      errors += 1;
      console.error(
        `[savedSearchRefresh] "${query}" failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[savedSearchRefresh] complete: ${byQuery.size} unique queries (${searches.length} saved searches), ${errors} errors`
  );
  return { searchesProcessed: byQuery.size, errors };
}

/** Hourly at :45 — staggered from refreshListings (:00, :30) and autoOcrLots (:15). */
export function startSavedSearchRefreshJob(): void {
  cron.schedule("45 * * * *", async () => {
    console.log(
      `[savedSearchRefresh] tick ${new Date().toISOString()}`
    );
    try {
      await runSavedSearchRefresh();
    } catch (err) {
      console.error(
        "[savedSearchRefresh] tick crashed:",
        err instanceof Error ? err.message : err
      );
    }
  });
  console.log("⏰  Saved-search refresh job scheduled (hourly at :45)");
}
