import cron from "node-cron";
// Prisma is imported as a value here (not `import type`) because we use the
// `Prisma.Decimal` runtime helper to construct prices safely.
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { fetchCardById } from "../services/pokemontcg.js";
import { resolveMarketPrice } from "../services/priceVariant.js";
import type { CardmarketPrices } from "../services/pokemontcg.js";

/**
 * Daily price-snapshot job — captures one row per (cardId, variant) per day
 * for every watched card. Powers the real price-history chart in the UI
 * (replacing the synthetic `buildSparkline` jitter).
 *
 * Schedule: "5 0 * * *" = 00:05 UTC every day. We run 5 minutes past the hour
 * so we don't clash with the listing-refresh cron (which runs at :00 and :30).
 *
 * For each watched card:
 *   1. Resolve the current market price via the same 4-tier waterfall
 *      listings use (tcgplayer → scrape → cardmarket → none). This means the
 *      chart's price line and the deal-score's comparison price always come
 *      from the same source — no chart-vs-score mismatch confusion.
 *   2. Insert one PriceSnapshot row.
 *   3. Prune snapshots older than RETENTION_DAYS so the table doesn't grow
 *      unbounded. We delete in the same job (no separate cleanup cron).
 *
 * Idempotency: re-running on the same UTC day creates a second row for that
 * day. The history endpoint groups by date, so duplicates collapse visually.
 * If we ever need strict dedup, add a unique index on (cardId, variant, date).
 */

const RETENTION_DAYS = 365;

export function startSnapshotJob(): void {
  cron.schedule("5 0 * * *", () => {
    void runSnapshot().catch((err) => {
      console.error("[snapshotJob] uncaught error:", err);
    });
  });
}

/**
 * Run a snapshot pass once. Exported so it can be triggered manually for
 * dev/backfill: `pnpm tsx server/src/jobs/snapshotPrices.ts`.
 */
export async function runSnapshot(): Promise<void> {
  console.log(`[snapshotJob] starting at ${new Date().toISOString()}`);
  const now = new Date();

  const cards = await prisma.watchedCard.findMany({
    include: { priceCache: true },
    // Distinct ensures we snapshot each unique card+variant only once even
    // when N users watch the same card. The chart is a property of the card,
    // not of any individual user's watch row.
    distinct: ["pokemonTcgId", "variant"],
  });

  console.log(`[snapshotJob] ${cards.length} unique card+variant pairs`);

  let written = 0;
  for (const card of cards) {
    try {
      // Use the cached priceCache when fresh; otherwise re-fetch. We don't
      // want this job to thunder against pokemontcg.io, but we also don't
      // want stale snapshots so we accept a re-fetch when needed.
      let variantsJson: unknown = card.priceCache?.variants ?? null;
      let cardmarketPrices: CardmarketPrices | null =
        (card.priceCache?.cardmarketPrices as CardmarketPrices | null) ?? null;
      const cacheStale = !card.priceCache || card.priceCache.expiresAt < now;

      if (cacheStale) {
        const fresh = await fetchCardById(card.pokemonTcgId);
        if (fresh) {
          variantsJson = fresh.variantPrices;
          cardmarketPrices = fresh.cardmarketPrices;
          // Note: we *don't* update the priceCache row here; that's the
          // listing route's job. The snapshot just needs the numbers.
        }
      }

      const resolved = await resolveMarketPrice({
        pokemonTcgId: card.pokemonTcgId,
        cardName: card.cardName,
        setName: card.setName,
        cardNumber: card.cardNumber,
        variant: card.variant,
        tcgplayerVariants: variantsJson,
        cardmarketPrices,
      });

      await prisma.priceSnapshot.create({
        data: {
          cardId: card.id,
          variant: card.variant,
          source: resolved?.source ?? "none",
          market: new Prisma.Decimal(resolved?.market ?? 0),
          currency: resolved?.currency ?? "USD",
        },
      });
      written += 1;
    } catch (err) {
      console.error(
        `[snapshotJob] ✗ ${card.pokemonTcgId} (${card.variant}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Prune old snapshots in the same pass.
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pruned = await prisma.priceSnapshot.deleteMany({
    where: { takenAt: { lt: cutoff } },
  });

  console.log(
    `[snapshotJob] done — wrote ${written}/${cards.length}, pruned ${pruned.count} > ${RETENTION_DAYS}d`
  );
}

// Allow `tsx server/src/jobs/snapshotPrices.ts` for manual runs/backfills.
// The `import.meta.url === pathToFileURL(process.argv[1])` check is the
// CommonJS-output-friendly version of "run when called directly."
if (process.argv[1]?.endsWith("snapshotPrices.js") || process.argv[1]?.endsWith("snapshotPrices.ts")) {
  void runSnapshot()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
