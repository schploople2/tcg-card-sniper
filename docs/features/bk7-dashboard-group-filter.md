# bk7 — Dashboard: filter listings by watchlist group

**Bead:** `tcg-card-sniper-dev-bk7` · **Theme:** Dashboard · **Builds on:** [4ke](4ke-watchlist-groups.md)
**Status:** ✅ shipped

## What it does

A new **Group** dropdown joins the Dashboard listings toolbar (right of the tier filter, left of type/sort). Options:

- **All groups** (default — no filter)
- One entry per `WatchlistGroup` the user owns
- **Ungrouped** — listings whose owning watched card has no group

The filter applies to **both** the **All listings** tab and the **Live auctions** tab — group membership is a card-identity concern, orthogonal to tier/type which are listing-flavor concerns and only show on "all". The Lots tab has no filter (lots aren't tied to a watched card).

## Architecture

```
GET /api/listings  ──▶  embedded card now includes groupId
                                       │
Dashboard rows useMemo ──▶ DealRow.groupId
                                       │
                  filterRowsByGroup(rows, groupFilter)
                       │
              filtered (All) + auctionRows (Auctions)
                       │
                       └──▶ deals table render
```

`filterRowsByGroup` is exported from `Dashboard.tsx` as a pure helper so the math is unit-coverable without mounting the page:

```ts
filterRowsByGroup(rows, GROUP_FILTER_ALL)       // === rows (no-op)
filterRowsByGroup(rows, GROUP_FILTER_UNGROUPED) // rows where groupId == null
filterRowsByGroup(rows, "<group-id>")           // rows where groupId === id
```

## Files

- [server/src/routes/listings.ts](../../server/src/routes/listings.ts) — added `groupId: true` to the embedded card select on `GET /api/listings`
- [client/src/hooks/useListings.ts](../../client/src/hooks/useListings.ts) — extended `ListingCardEmbed` with `groupId: string | null`
- [client/src/pages/Dashboard.tsx](../../client/src/pages/Dashboard.tsx) — new state, dropdown UI, applied in both `filtered` and `auctionRows` useMemos; exported `filterRowsByGroup` + sentinel constants
- [client/src/pages/__tests__/Dashboard.filter.test.ts](../../client/src/pages/__tests__/Dashboard.filter.test.ts) — 6 tests covering each filter mode + edge cases

## Verification

- [x] Server build clean
- [x] Client build clean
- [x] Server tests: 313/313
- [x] Client tests: 98/98 (was 92)
- [ ] Hands-on browser test against prod: create a group, assign a watched card to it, refresh the Dashboard, open the Group dropdown, select the group, confirm only that group's listings remain across both All and Auctions tabs; select Ungrouped, confirm inverse

## Out of scope

- Multi-group selection (one group at a time for now)
- Persisting the selected group across reloads
- A "Group" column in the deals table (the filter is enough signal)
- Filtering Lots / Saved-lots by group (lots aren't tied to a watched card)
