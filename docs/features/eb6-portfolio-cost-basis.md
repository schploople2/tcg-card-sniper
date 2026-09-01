# eb6 — D1: Collection tracking with cost basis

**Bead:** `tcg-card-sniper-dev-eb6` · **Theme:** D (Portfolio + power-user tools)
**Status:** ✅ shipped
**Migration:** `20260901170831_collection_item`

## What it does

A new `/portfolio` page — "My cards" inventory distinct from the Radiant
Collection checklist (hpx/cxu). Users log what they actually paid for a
card, graded slab, or sealed product; the page shows current market value
and unrealized P&L per item plus a rollup summary.

- **Add item** dialog: pick Raw / Graded / Sealed, search the catalog (same
  picker as the Watchlist "add card" flow) to link a specific printing +
  variant, or (sealed only) type a free-text label for product with no
  single-card catalog row (booster boxes, ETBs). Graded items also capture
  grading company + grade.
- Each row shows what was paid, current market value, and unrealized P&L
  (green/red), or **"— unpriced"** when the price waterfall has nothing
  cached for that card/variant yet.
- Summary bar: item count, total cost basis, total current value, total
  unrealized P&L — with unpriced items called out separately (excluded
  from the P&L total rather than silently counted as a $0 loss).
- Delete via a confirm dialog (mirrors the Watchlist delete flow).

## Why a new model instead of reusing CollectionEntry

`CollectionEntry` (hpx) is a boolean "collected" checklist scoped to the
57-card Radiant subset — presence of a row is the only signal, no
quantity/price/date. D1 needed a different shape entirely (cost basis,
quantity, acquisition date, raw/graded/sealed, optional sealed product with
no catalog row) so it's a separate `CollectionItem` model rather than
widening CollectionEntry's meaning.

## How it works

1. **Pricing** reuses the existing tcgplayer → cardmarket waterfall
   (`getMarketForVariant` / `getCardmarketForVariant` in
   `server/src/services/priceVariant.ts`), reading straight off the
   `Card.tcgplayerPrices` / `Card.cardmarketPrices` cache columns. The GET
   list route deliberately **skips the live TCGPlayer-scrape tier** —
   `resolveMarketPrice`'s tier 2 hits the network per card, which is fine
   for a single-card lookup but wrong for a list endpoint rendered on every
   page load. An item with no cached price shows `currentMarket: null`
   rather than a network round-trip.
2. **Sealed product** without a catalog row: `cardId` is nullable;
   `label` carries the display name in that case. The create route enforces
   raw/graded require `cardId` + `variant`; sealed requires either a linked
   card or a `label`; graded requires `gradingCompany` + `grade`. (Schema
   itself doesn't enforce this — it's a route-level `zod.refine` chain —
   since Postgres check constraints across nullable groups add migration
   complexity this feature doesn't need yet.)
3. **P&L math**: `totalCost = acquisitionPrice × quantity`,
   `currentValue = currentMarket × quantity`,
   `unrealizedPnl = currentValue - totalCost`. The summary's `totalPnl` is
   computed only over *priced* items — otherwise an unpriced item would
   count its full cost against zero value and understate the real P&L. The
   response's `pricedCount` vs `count` mismatch is the client's cue to
   render "N unpriced item(s) excluded".
4. **Card validation**: `POST /api/portfolio` requires `cardId` (when
   present) to already exist in the local `Card` catalog table — the same
   table `/api/catalog/search` reads from, populated by the weekly
   `syncCatalog` job. This mirrors `CollectionEntry`'s existing pattern
   rather than re-fetching pokemontcg.io live per add.

## Files

### Server
- [prisma/schema.prisma](../../prisma/schema.prisma) — new `CollectionItem` model + reverse relations on `User` and `Card`
- [prisma/migrations/20260901170831_collection_item/migration.sql](../../prisma/migrations/20260901170831_collection_item/migration.sql) — handwritten (local Postgres not running), same pattern as `20260602195512_collection_entry`
- [server/src/routes/portfolio.ts](../../server/src/routes/portfolio.ts) — new router; `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`; exports `annotatePortfolioItem` as a pure, testable pricing/P&L helper
- [server/src/index.ts](../../server/src/index.ts) — mount at `/api/portfolio`
- [server/src/routes/__tests__/portfolio.test.ts](../../server/src/routes/__tests__/portfolio.test.ts) — 6 tests covering tcgplayer/cardmarket tiers, no-price case, quantity scaling, sealed label fallback, graded fields

### Client
- [client/src/types/index.ts](../../client/src/types/index.ts) — `PortfolioItem`, `PortfolioSummary`, `CollectionItemKind`, create/update payload types
- [client/src/hooks/usePortfolio.ts](../../client/src/hooks/usePortfolio.ts) — react-query query + create/update/delete mutations
- [client/src/pages/Portfolio.tsx](../../client/src/pages/Portfolio.tsx) — new page; summary bar, item rows, add-item dialog (reuses the Watchlist catalog-search picker pattern), delete confirm dialog
- [client/src/pages/__tests__/Portfolio.test.tsx](../../client/src/pages/__tests__/Portfolio.test.tsx) — 7 tests covering loading/error/empty states, summary math, row rendering, delete flow, dialog open
- [client/src/App.tsx](../../client/src/App.tsx) — `/portfolio` route behind `RequireAuth`
- [client/src/components/layout/TopNav.tsx](../../client/src/components/layout/TopNav.tsx) — new nav link with `Wallet` icon

## Verification

- [x] Server build (`pnpm --filter server build`) clean
- [x] Client build (`pnpm --filter client build`) clean
- [x] Server tests: 319/319 (was 313)
- [x] Client tests: 105/105 (was 98)
- [ ] Hands-on browser test against Railway-deployed server: add a raw card via catalog search → row shows current market + P&L; add a sealed item by label with no catalog link → shows "— unpriced"; add a graded item → grading company/grade render; delete an item → confirm dialog → row disappears; reload → totals persist

## Out of scope (potential follow-ups)

- Editing an item's card/variant/kind after creation (currently delete + re-add) — `PATCH` only covers quantity, acquisition price, date, notes, and grading fields
- Realized P&L (tracking sales, not just holdings)
- A real sealed-product catalog (booster box/ETB pricing) — sealed items with no `cardId` always show "— unpriced" today
- Bulk import (CSV) for large existing collections
- Feeding portfolio value into any alert or dashboard summary outside `/portfolio` itself
- Per-item price history / a value-over-time chart (would need a CollectionItem-scoped PriceSnapshot-like table)
