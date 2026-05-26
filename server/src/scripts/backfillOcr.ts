import { prisma } from "../db.js";
import { runLotVision, visionEnabled } from "../services/lotVisionAi.js";
import { evaluateLotAfterOcr, evaluateLotForMistitling } from "../services/lotAlerts.js";
import { getTodayUsage } from "../services/ocrUsage.js";

// A5 — one-shot backfill. Walks every Lot whose LotImage rows all have
// ocrText IS NULL and runs the same vision + alert pipeline the hourly
// autoOcrLots cron runs, minus the SWEEP_BUDGET cap. Side effect: fires
// A1/A2 alerts on inventory that predates A4 or got outpaced by inflow.

const MIN_LISTING_PRICE_USD = 5;
const SYSTEM_USER_ID = "system:autoocr";
const INTER_CALL_DELAY_MS = 1000;
const PROGRESS_EVERY = 10;
const USD_PER_IMAGE = 0.003;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!visionEnabled()) {
    console.error("[backfillOcr] visionEnabled() = false — set OCR_PROVIDER. Exiting.");
    process.exit(1);
  }

  const startedAt = new Date();
  const usageBefore = await getTodayUsage(SYSTEM_USER_ID);

  const idRows: Array<{ ebayItemId: string }> = await prisma.$queryRaw`
    SELECT "ebayItemId"
    FROM "LotImage"
    GROUP BY "ebayItemId"
    HAVING COUNT(*) > 0 AND COUNT("ocrText") = 0
  `;

  if (idRows.length === 0) {
    console.log("[backfillOcr] no un-OCR'd lots found. Nothing to do.");
    return;
  }

  const limitEnv = process.env.BACKFILL_LIMIT;
  const limit = limitEnv ? Number.parseInt(limitEnv, 10) : undefined;
  if (limitEnv && (!Number.isFinite(limit) || limit! <= 0)) {
    console.error(`[backfillOcr] invalid BACKFILL_LIMIT=${limitEnv}. Exiting.`);
    process.exit(1);
  }

  const candidates = await prisma.lot.findMany({
    where: {
      ebayItemId: { in: idRows.map((r) => r.ebayItemId) },
      listingPrice: { gt: MIN_LISTING_PRICE_USD },
    },
    orderBy: { listingPrice: "desc" },
    select: { ebayItemId: true, title: true, listingPrice: true },
    ...(limit ? { take: limit } : {}),
  });

  console.log(
    `[backfillOcr] ${candidates.length} candidates · ${idRows.length} un-OCR'd lots total · listingPrice > $${MIN_LISTING_PRICE_USD}${limit ? ` · BACKFILL_LIMIT=${limit}` : ""}`,
  );

  let processed = 0;
  let errors = 0;
  let providerAllFailed = 0;

  for (const c of candidates) {
    try {
      console.log(
        `[backfillOcr] (${processed + 1}/${candidates.length}) ${c.ebayItemId} $${c.listingPrice} "${c.title.slice(0, 60)}"`,
      );
      const result = await runLotVision(c.ebayItemId, { userId: SYSTEM_USER_ID });
      processed += 1;
      console.log(
        `[backfillOcr]   → ${result.suggestions.length} suggestions (${result.imagesProcessed} fresh, ${result.imagesFailed} failed, status=${result.providerStatus})`,
      );
      if (result.providerStatus === "all-failed") {
        providerAllFailed += 1;
      } else {
        await evaluateLotAfterOcr(c.ebayItemId);
        await evaluateLotForMistitling(c.ebayItemId);
      }
    } catch (err) {
      errors += 1;
      console.error(
        `[backfillOcr]   ✗ ${c.ebayItemId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }

    if (processed > 0 && processed % PROGRESS_EVERY === 0) {
      await logProgress(processed, candidates.length, startedAt, usageBefore.imagesProcessed);
    }

    if (processed < candidates.length) {
      await sleep(INTER_CALL_DELAY_MS);
    }
  }

  console.log("[backfillOcr] ───────── final ─────────");
  await logProgress(processed, candidates.length, startedAt, usageBefore.imagesProcessed);
  console.log(
    `[backfillOcr] errors=${errors} providerAllFailed=${providerAllFailed} elapsed=${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`,
  );
}

async function logProgress(
  processed: number,
  total: number,
  startedAt: Date,
  imagesBefore: number,
): Promise<void> {
  const usageNow = await getTodayUsage(SYSTEM_USER_ID);
  const imagesThisRun = Math.max(0, usageNow.imagesProcessed - imagesBefore);
  const spend = (imagesThisRun * USD_PER_IMAGE).toFixed(2);
  const alertsThisRun = await prisma.alert.count({
    where: {
      kind: { in: ["LOT_HOT", "MISTITLED"] },
      createdAt: { gte: startedAt },
    },
  });
  console.log(
    `[backfillOcr]   tally: ${processed}/${total} lots · ${imagesThisRun} images · ~$${spend} · ${alertsThisRun} alerts created`,
  );
}

main()
  .catch((err) => {
    console.error("[backfillOcr] crashed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
