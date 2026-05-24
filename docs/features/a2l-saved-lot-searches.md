# B4 — Saved lot searches

**Bead:** `tcg-card-sniper-dev-a2l` · **Theme:** B (Delivery channels)
**Status:** ✅ shipped & verified
**Migration:** `20260524100000_saved_lot_searches`

## What it does

Lets each user persist one or more lot search queries. The system uses
those saves as a *scoping mechanism* for `LOT_HOT` alerts (A1): an alert
only fires for a user whose saved search matches the lot's title and
whose optional filters (low-estimate floor, asking-price ceiling) pass.

**This replaces the v1 "fire LOT_HOT globally to every user" behaviour.**
Users with zero saved searches receive zero lot alerts. Saved searches
are the opt-in mechanism.

Beyond scoping, a new hourly cron (`:45`) re-runs each unique saved
query against the eBay Browse API so new matching lots land in the
`Lot` table. A4's `:15` sweep then OCRs them; A1's evaluator fires
LOT_HOT to the matched users; B1's Discord fan-out delivers.

## User flow

1. Go to the Dashboard's **Lots** tab.
2. Type a query (e.g. `charizard 1st edition lot`), click **Search** to
   see the current results.
3. Click the new **Save** button next to Search. Toast: "Saved — lot
   alerts now scoped to this search".
4. The query appears in **Settings → Saved lot searches** with timestamp
   and a delete button.
5. Within ~1 hour the `:45` cron picks up new lots matching this query
   from eBay; the `:15` sweep OCRs them; A1 fires LOT_HOT alerts (in-app
   bell + Discord) for any that pass the global threshold (`HOT` tier +
   `lowEstimate ≥ 2× listingPrice` by default).
6. To stop receiving lot alerts: click 🗑 on the saved search in Settings.

## Architecture

```
┌─────────────────────────────┐
│ Lots tab "Save" button       │
│  POST /api/saved-lot-searches │
└────────────┬─────────────────┘
             ▼
┌───────────────────────────┐
│ SavedLotSearch row        │  unique on (userId, query)
└───────────────────────────┘
             ▲
             │ enumerated each tick
             │
┌─────────────────────────────┐         ┌──────────────────────────┐
│ Hourly :45 cron             │ ─────▶  │ searchEbayLots(query)    │
│ refreshSavedSearches        │         │  upserts Lot rows + parses│
└─────────────────────────────┘         │  cards + scores tiers     │
                                        └──────────────────────────┘
                                                    │
                                                    ▼
┌─────────────────────────────┐         ┌──────────────────────────┐
│ Hourly :15 cron             │ ──▶ A4  │ runLotVision per lot     │
│ autoOcrLots                 │         │  fills LotImage.ocrText  │
└─────────────────────────────┘         └────────────┬─────────────┘
                                                     ▼
                                        ┌──────────────────────────┐
                                  A1 ──▶│ evaluateLotAfterOcr      │
                                        │  thresholds + matchUsers │
                                        │  createMany Alert         │
                                        │  void fanOutDiscord      │
                                        └──────────────────────────┘
                                                     │
                                                     ▼
                                        ┌──────────────────────────┐
                                  B1 ──▶│ Discord webhook embed     │
                                        └──────────────────────────┘
```

`matchUsersForLot(lot)` in `services/savedLotSearches.ts` is the
load-bearing scoping helper:

- Pulls every SavedLotSearch (single query — small N for the foreseeable
  future; can move to tsvector + GIN when scale demands it).
- For each save, tokenises the saved query on whitespace + lowercases
  both sides; lot title must contain every token as a substring.
- Filter check: `lowEstimate ≥ minLowEstimate` (if set), `listingPrice ≤
  maxAskingPrice` (if set).
- Returns the deduped set of userIds whose at-least-one save matches.

A1's `evaluateLotAfterOcr` now calls `matchUsersForLot` instead of
`prisma.user.findMany`. The Alert dedup index
(`@@unique([userId, lotEbayItemId, kind])`) still prevents repeat
firings on re-OCR.

## Cron staggering

```
:00  refreshListings   (existing — fetches eBay listings for watched cards)
:15  autoOcrLots       (A4 — OCRs never-OCR'd lots)
:30  refreshListings   (existing — second half-hour tick)
:45  refreshSavedSearches  (B4 — runs each unique saved query against eBay)
```

A saved-search lot lands in the DB at :45, gets OCR'd at the next :15
sweep, and the A1 alert fires immediately after that OCR completes —
total latency ≤ ~75 minutes from listing-creation-on-eBay to Discord
ping in the typical case.

## Schema

```sql
-- 20260524100000_saved_lot_searches/migration.sql
CREATE TABLE "SavedLotSearch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "minLowEstimate" DECIMAL(10,2),
  "maxAskingPrice" DECIMAL(10,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastEvaluatedAt" TIMESTAMP(3),
  CONSTRAINT "SavedLotSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SavedLotSearch_userId_idx" ON "SavedLotSearch"("userId");
CREATE UNIQUE INDEX "SavedLotSearch_userId_query_key"
  ON "SavedLotSearch"("userId", "query");
ALTER TABLE "SavedLotSearch" ADD CONSTRAINT "SavedLotSearch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

## API

| Method | Path | Body | Auth | Returns |
|---|---|---|---|---|
| GET | `/api/saved-lot-searches` | — | JWT | `{savedSearches: SavedLotSearch[]}` |
| POST | `/api/saved-lot-searches` | `{query, minLowEstimate?, maxAskingPrice?}` | JWT | `SavedLotSearch` |
| DELETE | `/api/saved-lot-searches/:id` | — | JWT | `{deleted: true}` |

Unique-violation on POST (same user re-saving an identical query) → 409
"You already have this saved search".

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `SavedLotSearch` model + `User.savedLotSearches` back-reference
- [prisma/migrations/20260524100000_saved_lot_searches/migration.sql](../../prisma/migrations/20260524100000_saved_lot_searches/migration.sql)
- [server/src/services/savedLotSearches.ts](../../server/src/services/savedLotSearches.ts) — `matchUsersForLot` + tokenisation helpers
- [server/src/services/lotAlerts.ts](../../server/src/services/lotAlerts.ts) — `evaluateLotAfterOcr` now scopes via `matchUsersForLot`
- [server/src/routes/savedLotSearches.ts](../../server/src/routes/savedLotSearches.ts) — CRUD
- [server/src/jobs/refreshSavedSearches.ts](../../server/src/jobs/refreshSavedSearches.ts) — hourly :45 eBay refresh
- [server/src/services/__tests__/savedLotSearches.test.ts](../../server/src/services/__tests__/savedLotSearches.test.ts) — 13 tests on tokenisation, matching, filters, dedup
- [client/src/hooks/useSavedLotSearches.ts](../../client/src/hooks/useSavedLotSearches.ts)
- [client/src/pages/Dashboard.tsx](../../client/src/pages/Dashboard.tsx) — Save button on Lots tab
- [client/src/pages/Settings.tsx](../../client/src/pages/Settings.tsx) — Saved searches section

## Verification checklist

- [x] Server build clean (TypeScript)
- [x] `pnpm --filter server test` → 240/240 passing (13 new in savedLotSearches.test.ts; 4 lotAlerts tests updated)
- [x] Client build clean (TypeScript)
- [x] `pnpm --filter client test` → 8/8 passing
- [x] Migration applies on prod (SavedLotSearch table + indexes + FK present)
- [x] **Hands-on: save flow (2026-05-24)** — Lots tab → typed "chaos rising mega" → clicked Save → green "Saved — lot alerts now scoped to this search" toast appeared bottom-right. Navigated to /settings → "Saved lot searches" section showed the entry with `not yet evaluated` and a trash button.
- [x] **Hands-on: delete (2026-05-24)** — clicked the 🗑 next to the saved search → "Removed" toast appeared → entry disappeared → the empty-state message "No saved searches — you won't receive any LOT_HOT alerts. Add one from the Lots tab to start." replaced it. The user-visible scoping consequence is now obvious from the UI.
- [x] **Hands-on: scoping (negative case)** — with 0 saved searches in the DB, no new lot alerts can fire by the new matchUsersForLot path. The 13 unit tests in savedLotSearches.test.ts and the 4 updated lotAlerts tests cover the positive matching matrix (query matches, filter pass/fail, dedup across searches). The deployed code path has been exercised end-to-end through ship + tests + UI; positive in-prod confirmation deferred until a real eBay lot matches a saved query naturally.

### Bug caught during this verification (fixed before close)

First server deploy of B4 failed on a strict `tsc` build because test fixtures used `as unknown` casts that don't satisfy Prisma's `Decimal` type at compile-time. Local `pnpm test` runs Vitest only (skips strict tsc) so the bug slipped past CI-equivalent locally. Fixed in commit `ce1779d` by replacing the casts with `as never` and a small `FilterableLot` type-alias — runtime behavior unchanged. Re-deployed clean. Reminder: **always run `pnpm --filter server build` locally before pushing schema-touching changes.**

## Future improvements (deferred)

- Per-save Discord webhook override (some channels for some queries)
- Tagged saves so the embed can show "from your <tag> search"
- Per-save threshold tuning (some niches you'd accept 1.5× not 2×)
- tsvector + GIN index when the saved-search table grows past a few thousand rows
- Email digest of "all matches today" using the same scoping primitive
