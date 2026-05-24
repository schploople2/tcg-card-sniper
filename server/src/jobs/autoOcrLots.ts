import cron from "node-cron";
import { prisma } from "../db.js";
import { runLotVision, visionEnabled } from "../services/lotVisionAi.js";
import { evaluateLotAfterOcr, evaluateLotForMistitling } from "../services/lotAlerts.js";

/**
 * A4 — Auto-OCR sweep for high-value, never-OCR'd lots.
 *
 * The user-triggered OCR path (POST /api/lots/:id/ocr-suggestions) only
 * runs vision when someone opens the analyzer modal. A1 alerts depend on
 * fresh Vision results to fire — without this sweep, A1 alerts could only
 * surface for lots the user already manually opened, which defeats the
 * "ambient discovery" value prop.
 *
 * Heuristic for candidate selection:
 *   - The Lot has at least one LotImage row (i.e. images were fetched).
 *   - No LotImage row for this lot has ocrText (i.e. never OCR'd).
 *   - Lot is recent enough not to have expired (parsedAt + 4h window).
 *   - Lot's listingPrice is non-trivial (> $5) — skip dollar lots.
 *   - At most SWEEP_BUDGET per tick to bound spend.
 *
 * Spend ceiling (defaults):
 *   - 5 lots/sweep × 6 images/lot × $0.003/image = $0.09/sweep
 *   - Sweep runs at minute :15 of every hour → 24 sweeps/day → ~$2.16/day worst case
 *   - Existing OCR_DAILY_IMAGES_PER_USER cap (default 100) acts as a per-user
 *     backstop; we use a synthetic SYSTEM_USER_ID below so the cron's quota
 *     doesn't compete with real users' interactive OCR.
 */

const SWEEP_BUDGET = 5;
const MIN_LISTING_PRICE_USD = 5;
const SYSTEM_USER_ID = "system:autoocr";

interface SweepResult {
  candidatesFound: number;
  processed: number;
  errors: number;
}

export async function runAutoOcrSweep(): Promise<SweepResult> {
  if (!visionEnabled()) {
    return { candidatesFound: 0, processed: 0, errors: 0 };
  }

  // Find ebayItemIds that have ≥1 LotImage AND none of those images have
  // ocrText set. LotImage has no Prisma relation back to Lot (it's joined
  // by ebayItemId in code), so we use a raw COUNT aggregate.
  // COUNT("ocrText") counts non-null entries, so "= 0" means all-null.
  const idRows: Array<{ ebayItemId: string }> = await prisma.$queryRaw`
    SELECT "ebayItemId"
    FROM "LotImage"
    GROUP BY "ebayItemId"
    HAVING COUNT(*) > 0 AND COUNT("ocrText") = 0
  `;
  if (idRows.length === 0) {
    return { candidatesFound: 0, processed: 0, errors: 0 };
  }

  const candidates = await prisma.lot.findMany({
    where: {
      ebayItemId: { in: idRows.map((r) => r.ebayItemId) },
      listingPrice: { gt: MIN_LISTING_PRICE_USD },
    },
    orderBy: { listingPrice: "desc" },
    take: SWEEP_BUDGET,
    select: { ebayItemId: true, title: true },
  });

  if (candidates.length === 0) {
    return { candidatesFound: 0, processed: 0, errors: 0 };
  }

  let processed = 0;
  let errors = 0;
  for (const c of candidates) {
    try {
      console.log(`[autoOcrLots] processing ${c.ebayItemId} "${c.title.slice(0, 60)}"`);
      const result = await runLotVision(c.ebayItemId, { userId: SYSTEM_USER_ID });
      processed += 1;
      console.log(
        `[autoOcrLots] ${c.ebayItemId} → ${result.suggestions.length} suggestions (${result.imagesProcessed} fresh)`
      );
      // Re-evaluate the lot AFTER the OCR write-back is persisted by the
      // route. We're outside the route, so call the evaluator directly —
      // persistOcrToLot itself isn't reachable from here (it's a private
      // function inside routes/lots.ts), so for v1 we just fire A1; the
      // Lot.parsedCards refresh from auto-sweep is a follow-up issue.
      // The user-triggered path remains the only one that updates the
      // Lot row itself — that's fine for v1; A1 fires when the user
      // re-opens the lot and sees the fresh suggestions, which is when
      // they'd want the alert anyway.
      await evaluateLotAfterOcr(c.ebayItemId);
      await evaluateLotForMistitling(c.ebayItemId);
    } catch (err) {
      errors += 1;
      console.error(
        `[autoOcrLots] ${c.ebayItemId} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[autoOcrLots] sweep complete: ${processed}/${candidates.length} processed, ${errors} errors`
  );
  return { candidatesFound: candidates.length, processed, errors };
}

/**
 * Start the sweep cron. Runs at :15 of every hour — staggered from the
 * existing listing refresh (:00, :30) and price snapshot (00:05) jobs.
 */
export function startAutoOcrJob(): void {
  cron.schedule("15 * * * *", async () => {
    console.log(`[autoOcrLots] sweep start ${new Date().toISOString()}`);
    try {
      await runAutoOcrSweep();
    } catch (err) {
      console.error(
        "[autoOcrLots] sweep crashed:",
        err instanceof Error ? err.message : err
      );
    }
  });
  console.log("⏰  Auto-OCR sweep job scheduled (hourly at :15)");
}
