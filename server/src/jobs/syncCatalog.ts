import axios from "axios";
import cron from "node-cron";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { invalidateNameTrie } from "../services/cardNameExtractor.js";

/**
 * Sync the full pokemontcg.io catalog into our local `Card` table.
 *
 * Why: live searches make 3-5 parallel Lucene calls against api.pokemontcg.io,
 * each ~500ms. Local Postgres + trigram index responds in single-digit ms.
 *
 * Schedule: weekly Sunday 03:00 UTC. New sets land roughly every 6-8 weeks,
 * and individual card *metadata* (name, number, set, variants) never changes
 * once published — only prices do, and those live in PriceCache, not here.
 *
 * The job is idempotent: it upserts by `id`, so re-running doesn't duplicate
 * rows. It does NOT delete cards that disappear from pokemontcg.io
 * (vanishingly rare; if it happens, we still serve the cached row).
 *
 * pokemontcg.io page cap is 250. We use the maximum and run sequentially —
 * parallel pagination doesn't help (their rate limiting is gentle but real,
 * and we have all day).
 */

const BASE_URL = "https://api.pokemontcg.io/v2";
const PAGE_SIZE = 250;
// Cards-only fields we care about. Skipping `cardmarket` and `tcgplayer`
// here because those vary per-fetch and live in PriceCache / scrape cache.
// We only persist a `hasCardmarket` boolean for "is there any pricing source"
// queries downstream.
const SELECT_FIELDS =
  "id,name,number,rarity,set,images,tcgplayer,cardmarket";

interface RawCard {
  id: string;
  name: string;
  number: string;
  rarity?: string;
  set: {
    id: string;
    name: string;
    series: string;
    releaseDate?: string;
    total?: number;
  };
  images?: { small?: string; large?: string };
  tcgplayer?: { prices?: Record<string, unknown> };
  cardmarket?: { prices?: Record<string, unknown> };
}

interface PageResponse {
  data: RawCard[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

export function startSyncCatalogJob(): void {
  cron.schedule("0 3 * * 0", () => {
    void runSyncCatalog().catch((err) =>
      console.error("[syncCatalog] uncaught error:", err)
    );
  });
}

export async function runSyncCatalog(): Promise<{
  fetched: number;
  upserted: number;
  totalCount: number;
  durationMs: number;
}> {
  const started = Date.now();
  console.log(`[syncCatalog] starting at ${new Date().toISOString()}`);

  // First page tells us totalCount so we know how many to iterate.
  let page = 1;
  let totalCount = 0;
  let fetched = 0;
  let upserted = 0;

  while (true) {
    let res;
    try {
      res = await axios.get<PageResponse>(`${BASE_URL}/cards`, {
        params: {
          page,
          pageSize: PAGE_SIZE,
          select: SELECT_FIELDS,
          orderBy: "id",
        },
        timeout: 30_000,
      });
    } catch (err) {
      const status =
        axios.isAxiosError(err) && err.response?.status
          ? err.response.status
          : "?";
      console.error(
        `[syncCatalog] axios FAILED on page=${page}: status=${status} msg=${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // 429 → back off and retry the same page. Anything else → abort the
      // run (we'll retry on the next cron tick). Errors here used to vanish
      // silently because the catch on the outer void wasn't flushing.
      if (
        axios.isAxiosError(err) &&
        (err.response?.status === 429 || err.code === "ECONNABORTED")
      ) {
        console.warn(`[syncCatalog] backing off 30s and retrying page=${page}`);
        await new Promise((r) => setTimeout(r, 30_000));
        continue;
      }
      throw err;
    }

    if (page === 1) {
      totalCount = res.data.totalCount;
      console.log(`[syncCatalog] totalCount=${totalCount}, paginating...`);
    }

    const cards = res.data.data;
    if (cards.length === 0) break;
    fetched += cards.length;

    try {
      // Run upserts sequentially rather than inside a giant 250-row Prisma
      // transaction. The transaction form has a default 5s timeout that's
      // too tight for 250 upserts over the public Railway DB latency, and
      // raising it requires a different Prisma overload. Sequential upserts
      // each run their own short txn and don't have that ceiling.
      for (const c of cards) {
        const variants = c.tcgplayer?.prices ? Object.keys(c.tcgplayer.prices) : [];
        const hasCardmarket = !!c.cardmarket?.prices;
        // Pb: persist prices on the Card row so lot valuation can read them
        // without going through PriceCache (which requires WatchedCard rows
        // that lot cards usually don't have). Prices go stale weekly with
        // the sync cadence — fine for "rough lot estimate" purposes.
        // Cast to InputJsonValue — Prisma's Json column accepts any
        // JSON-serialisable shape but TS doesn't infer that from the raw
        // pokemontcg.io response shape, which has optional-number fields.
        const tcgplayerPrices = (c.tcgplayer?.prices ?? null) as Prisma.InputJsonValue | null;
        const cardmarketPrices = (c.cardmarket?.prices ?? null) as Prisma.InputJsonValue | null;
        await prisma.card.upsert({
          where: { id: c.id },
          create: {
            id: c.id,
            name: c.name,
            number: c.number,
            rarity: c.rarity ?? null,
            setId: c.set.id,
            setName: c.set.name,
            setSeries: c.set.series,
            setReleaseDate: c.set.releaseDate ?? null,
            setTotal: c.set.total ?? null,
            imageSmall: c.images?.small ?? null,
            imageLarge: c.images?.large ?? null,
            variants,
            hasCardmarket,
            tcgplayerPrices: tcgplayerPrices ?? undefined,
            cardmarketPrices: cardmarketPrices ?? undefined,
          },
          update: {
            name: c.name,
            number: c.number,
            rarity: c.rarity ?? null,
            setId: c.set.id,
            setName: c.set.name,
            setSeries: c.set.series,
            setReleaseDate: c.set.releaseDate ?? null,
            setTotal: c.set.total ?? null,
            imageSmall: c.images?.small ?? null,
            imageLarge: c.images?.large ?? null,
            variants,
            hasCardmarket,
            tcgplayerPrices: tcgplayerPrices ?? undefined,
            cardmarketPrices: cardmarketPrices ?? undefined,
            syncedAt: new Date(),
          },
        });
      }
    } catch (err) {
      console.error(
        `[syncCatalog] PRISMA upsert FAILED on page=${page}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      throw err;
    }
    upserted += cards.length;

    // Log every page so silent stalls are obvious.
    console.log(
      `[syncCatalog] page=${page} fetched=${fetched}/${totalCount} (${((fetched / totalCount) * 100).toFixed(1)}%)`
    );

    if (cards.length < PAGE_SIZE) break;
    page += 1;

    // Pace under pokemontcg.io's ~30 req/min anonymous limit. 2.5s/page → 24/min, safe headroom.
    await new Promise((r) => setTimeout(r, 2500));
  }

  const durationMs = Date.now() - started;
  console.log(
    `[syncCatalog] done: fetched=${fetched} upserted=${upserted} totalCount=${totalCount} in ${(durationMs / 1000).toFixed(1)}s`
  );

  // Invalidate the cardNameExtractor's in-memory trie so lot parsing
  // picks up any newly-released cards on the next request.
  invalidateNameTrie();

  return { fetched, upserted, totalCount, durationMs };
}

// Allow `tsx server/src/jobs/syncCatalog.ts` for ad-hoc runs.
if (process.argv[1]?.endsWith("syncCatalog.js") || process.argv[1]?.endsWith("syncCatalog.ts")) {
  void runSyncCatalog()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
