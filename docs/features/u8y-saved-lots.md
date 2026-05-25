# u8y — Saved Lots

**Bead:** `tcg-card-sniper-dev-u8y` · **Theme:** D (Portfolio + power-user)
**Status:** ✅ shipped
**Migration:** `20260525194017_saved_lot`

## What it does

Lets a user pin individual eBay lot listings they want to revisit later. Saved lots show up in a new **Saved** tab on the Dashboard's Lots search bar with a count badge. The save action is reachable from two places:

- **Bookmark icon** on each `LotCard` in search results
- **"Save lot" button** in the footer of the analyzer modal

A saved lot snapshots `title / imageUrl / ebayUrl / listingPrice` directly on the `SavedLot` row, so the saved list keeps rendering even after the underlying `Lot` cache row evicts (30-min TTL). Clicking Analyze on a saved row opens the same `LotAnalyzerModal` against a minimal "shadow Lot" constructed from the snapshot — the modal then hydrates images / annotations / OCR via its own queries.

## User flow

1. Open the Lots tab → search → click the 🔖 bookmark on any lot. Toast confirms "Saved."
2. Switch to the **Saved** tab → the lot appears with thumbnail, title, price, and a "Saved <date>" timestamp.
3. To remove: 🗑 trash icon on the row OR click the bookmark again on the live search result.
4. To open: Analyze button on the saved row → analyzer modal opens, drawer/chips/notes/Save analysis all work normally.

## v1 scope + known limitations

- **Snapshot is point-in-time.** If the listing's price changes on eBay, the saved row still shows the price you saved it at until you re-open the live search. Future: a "refresh from eBay" button per saved row.
- **No alerts.** Saved lots don't fire any background alerts — they're a passive pin. Future: optional "alert me when this auction ends" or "alert me if price drops below X."
- **Shadow Lot for the analyzer.** When you Analyze a saved lot whose underlying `Lot` row has expired, the modal renders the header + image but `parsedCards`, `lowEstimate`, and `lotTier` start empty. The OCR/annotation flow still works because those have their own per-lot cached state. Re-searching the original query rehydrates fully.
- **No bulk delete.** Trash icon is per-row only. Power users with hundreds of saved lots may want multi-select later.

## Architecture

```
LotCard / LotAnalyzerModal
   │  (click bookmark or "Save lot")
   ▼
useCreateSavedLot / useDeleteSavedLot
   │
   ▼
POST/DELETE /api/saved-lots
   │
   ▼
Prisma SavedLot table (unique on userId+ebayItemId)
   │
   ▼ (react-query invalidate ["savedLots"])
useSavedLots()
   ├── SavedLotsTab — renders rows
   └── useIsLotSaved(ebayItemId) — derived helper feeds the
       bookmark filled/outline state on every LotCard
```

## Schema

```sql
-- 20260525194017_saved_lot/migration.sql
CREATE TABLE "SavedLot" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "ebayItemId"   TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "imageUrl"     TEXT,
  "ebayUrl"      TEXT NOT NULL,
  "listingPrice" DECIMAL(10,2) NOT NULL,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedLot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SavedLot_userId_ebayItemId_key" ON "SavedLot"("userId", "ebayItemId");
CREATE INDEX "SavedLot_userId_createdAt_idx" ON "SavedLot"("userId", "createdAt");
ALTER TABLE "SavedLot" ADD CONSTRAINT "SavedLot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/saved-lots` | — | `{ savedLots: SavedLot[] }`, sorted `createdAt desc` |
| POST | `/api/saved-lots` | `{ ebayItemId, title, imageUrl?, ebayUrl, listingPrice, note? }` | created `SavedLot` (409 on duplicate) |
| DELETE | `/api/saved-lots/:id` | — | `{ deleted: true }` |

All endpoints require JWT auth and scope to `req.user!.userId`. Duplicate POST returns `409 "You already saved this lot"`.

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `SavedLot` model + `User.savedLots` relation
- [prisma/migrations/20260525194017_saved_lot/migration.sql](../../prisma/migrations/20260525194017_saved_lot/migration.sql)
- [server/src/routes/savedLots.ts](../../server/src/routes/savedLots.ts) — CRUD router
- [server/src/index.ts](../../server/src/index.ts) — mount at `/api/saved-lots`
- [client/src/hooks/useSavedLots.ts](../../client/src/hooks/useSavedLots.ts) — `useSavedLots`, `useCreateSavedLot`, `useDeleteSavedLot`, `useIsLotSaved`
- [client/src/components/shared/LotCard.tsx](../../client/src/components/shared/LotCard.tsx) — bookmark toggle
- [client/src/components/shared/LotAnalyzerModal.tsx](../../client/src/components/shared/LotAnalyzerModal.tsx) — "Save lot" footer button
- [client/src/components/shared/SavedLotsTab.tsx](../../client/src/components/shared/SavedLotsTab.tsx) — new tab body
- [client/src/components/shared/__tests__/SavedLotsTab.test.tsx](../../client/src/components/shared/__tests__/SavedLotsTab.test.tsx) — 6 tests
- [client/src/pages/Dashboard.tsx](../../client/src/pages/Dashboard.tsx) — 4th tab + count badge

## Verification

- [x] Server build clean (strict tsc)
- [x] 290/290 server tests
- [x] 45/45 client tests (was 39)
- [x] Client build clean
- [x] Migration applied to prod (trgm `DROP INDEX`es stripped per the documented gotcha)
- [ ] Hands-on prod test: search Lots → click bookmark → switch to Saved tab → row appears → click bookmark again on the live row OR trash on the saved row → row disappears
