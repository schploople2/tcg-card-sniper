# hpx — Radiant Collection tracker

**Bead:** `tcg-card-sniper-dev-hpx` · **Theme:** Collection
**Status:** ✅ shipped

## What it does

A new top-level page at `/collection` shows a mobile-friendly gallery of the 57 cards in the **Radiant Collection** subset — split across **Generations (g1)** RC1–RC32 and **Legendary Treasures (bw11)** RC1–RC25. Each card is a tappable tile:

- **Tap** → toggles "collected" for the signed-in user (instant via optimistic update).
- **Collected** cards render in full color with a yellow checkmark badge.
- **Not collected** cards render greyscaled + ~40% opacity.
- A header reports `<collected> / 57 collected` plus a percentage and progress bar.
- Each set has its own section with per-set count (`<n> / 32`, `<n> / 25`).

Responsive grid: 3 cols on mobile, 5 on `sm`, 6 on `md+`. Tile `<button>`s expose `aria-pressed` + descriptive `aria-label`, so screen readers and keyboard users can navigate without sight.

## Architecture

```
                 GET /api/collection/radiant
                        │
React /collection   ◀───┘   returns { total, collected, sets: [{ setId, total, collected, cards: [{…, collected }] }] }
   │
   ├── ProgressBar  (header — total/57, %)
   ├── SetSection × 2 (Generations, Legendary Treasures)
   │     └── CardTile × N   ── onClick ──▶  POST /api/collection/:cardId/toggle
   │                              │
   │                              └── optimistic update on the cached
   │                                  RADIANT_KEY query before the request lands
```

Presence-of-row is the source of truth — `CollectionEntry { userId, cardId, collectedAt }` with a unique index on `(userId, cardId)`. Toggling deletes the row if it exists, otherwise creates it. No soft-delete; the timestamp is "first collected at this time" and resets if the user un-collects and re-collects.

The two Radiant subsets live in a hard-coded constant in [`server/src/routes/collection.ts`](../../server/src/routes/collection.ts) — `RADIANT_SETS = [{ setId: "g1", setName: "Generations", total: 32 }, { setId: "bw11", setName: "Legendary Treasures", total: 25 }]`. Cards are matched by `setId IN ('g1','bw11') AND number LIKE 'RC%'`, then JS-sorted by the numeric portion of the `RC<n>` string (so RC2 comes before RC10).

## Files

### Server
- [prisma/schema.prisma](../../prisma/schema.prisma) — new `CollectionEntry` model + reverse relations on `User` and `Card`
- [prisma/migrations/20260602195512_collection_entry/migration.sql](../../prisma/migrations/20260602195512_collection_entry/migration.sql) — handwritten (local Postgres not running) following the same shape Prisma would produce; applied by `prisma migrate deploy` on Railway boot
- [server/src/routes/collection.ts](../../server/src/routes/collection.ts) — new router; `GET /radiant`, `POST /:cardId/toggle`; exports `groupRadiantCards` as a pure helper
- [server/src/index.ts](../../server/src/index.ts) — mount at `/api/collection`
- [server/src/routes/__tests__/collection.test.ts](../../server/src/routes/__tests__/collection.test.ts) — 7 tests covering `rcNumber` natural sort, set ordering, collected annotation, per-set & global counts, declared totals

### Client
- [client/src/hooks/useRadiantCollection.ts](../../client/src/hooks/useRadiantCollection.ts) — react-query query + mutation with optimistic update
- [client/src/pages/Collection.tsx](../../client/src/pages/Collection.tsx) — new page; ProgressBar + SetSection + CardTile
- [client/src/pages/__tests__/Collection.test.tsx](../../client/src/pages/__tests__/Collection.test.tsx) — 5 tests covering loading, error, progress headline, collected/not-collected rendering, click → mutation
- [client/src/App.tsx](../../client/src/App.tsx) — `/collection` route behind `RequireAuth`
- [client/src/components/layout/TopNav.tsx](../../client/src/components/layout/TopNav.tsx) — new nav link with `Sparkles` icon

## Verification

- [x] Server build (`pnpm --filter server build`) clean
- [x] Client build (`pnpm --filter client build`) clean
- [x] Server tests: 313/313 (was 306)
- [x] Client tests: 70/70 (was 65)
- [ ] Hands-on browser test against Railway-deployed server: sign in → tap a few cards → reload → state persists; collected counter increments; greyscale toggles cleanly

## Out of scope (potential follow-ups)

- Hidden Fates Shiny Vault (sm115, SV1–SV94)
- Sword & Shield "Radiant" Pokémon (~14 individual cards across SWSH sets)
- Per-variant tracking (holofoil vs reverse vs normal owned separately)
- Showing dupes / quantity
- "Show me listings for cards I'm missing" deal-score integration
- Sharing a public read-only view of a user's collection
