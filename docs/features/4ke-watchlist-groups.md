# 4ke — Watchlist groups (collapsible sections + per-card group picker)

**Bead:** `tcg-card-sniper-dev-4ke` · **Theme:** Watchlist UX
**Status:** ✅ shipped

## What it does

Users can create named groups on the Watchlist page (e.g. **High Priority Cards**, **Long-term Targets**) and assign cards to one group at a time. The page is now bucketed: every group renders as a collapsible section with `▼ <Name>  (N cards)  · ⋮`. The kebab menu opens **Rename** or **Delete**. Deleting a group never deletes cards — they orphan back to the always-present **Ungrouped** section.

Two surfaces let users assign a group:
1. **Add-card dialog** — a new "Group" field (defaults to Ungrouped, has inline "+ New group…" option).
2. **Per-card chip** — a compact dropdown on every card (next to the variant badge). Picking a different group moves the card immediately.

The page header gains a **+ New Group** button next to **+ Add Card** for users who want to create groups before adding cards.

## Data model

```prisma
model WatchlistGroup {
  id, userId, name, sortOrder, createdAt, updatedAt
  @@unique([userId, name])   // dupes-by-name impossible per user
  @@index([userId])
}

WatchedCard.groupId String?
  onDelete: SetNull          // ← critical: deleting a group keeps the cards
@@index([userId, groupId])   // fast bucket-by-group query (future)
```

The `SetNull` rule is the load-bearing invariant: it means **deleting a group is always safe** — the cards re-bucket to Ungrouped, and the user can re-categorize at leisure. We never need a "are you sure? this will delete N cards" warning, because it won't.

## Server

| Method | Path                              | Notes |
|-------:|-----------------------------------|-------|
|   GET  | `/api/watchlist-groups`           | List user's groups w/ `cardCount`, ordered by `sortOrder` then `createdAt` |
|  POST  | `/api/watchlist-groups`           | Create. `sortOrder` auto-assigned to current max + 1. 409 on duplicate name. |
| PATCH  | `/api/watchlist-groups/:id`       | Partial: `name` and/or `sortOrder`. 409 on rename collision. |
| DELETE | `/api/watchlist-groups/:id`       | 204. Cards orphan via SetNull. |

Plus two existing endpoints extended:
- `POST /api/cards` — accepts optional `groupId`. Server validates the group belongs to the user (`assertGroupOwnedByUser`) before assigning.
- `PATCH /api/cards/:id` — accepts `groupId: string | null` (null = move to Ungrouped). Same ownership guard.

`GET /api/cards` already returns the full WatchedCard row, which now includes `groupId` automatically.

## Client

- `useWatchlistGroups()` + `useCreateGroup()` / `useRenameGroup()` / `useDeleteGroup()` mutations. Delete invalidates both `GROUPS_KEY` and `CARDS_KEY` so the bucketing refreshes.
- `WatchlistGroupPicker` component (`chip` + `form` variants) used on every card AND in the add dialog. Built on Radix Select. Inline "+ New group…" opens a small dialog, auto-selects the created group.
- `Watchlist.tsx` reorganized: cards bucket into `GroupSection` components. Real groups render in `sortOrder`; **Ungrouped is always last**. Empty Ungrouped is hidden when the user has at least one real group (no clutter).
- `GroupSection` handles its own collapse state, rename dialog, and delete confirm. Delete confirm message explicitly states "N cards will move to Ungrouped — none will be deleted."

## Files

### Server
- [prisma/schema.prisma](../../prisma/schema.prisma) — new `WatchlistGroup` model, `WatchedCard.groupId` + index, reverse relations on `User` and `WatchedCard`
- [prisma/migrations/20260602221922_watchlist_group/migration.sql](../../prisma/migrations/20260602221922_watchlist_group/migration.sql) — handwritten (local Postgres not running), follows the project convention used for `collection_entry` etc.
- [server/src/routes/watchlistGroups.ts](../../server/src/routes/watchlistGroups.ts) — new router (GET/POST/PATCH/DELETE)
- [server/src/routes/cards.ts](../../server/src/routes/cards.ts) — extended create/update schemas + new `assertGroupOwnedByUser` guard
- [server/src/index.ts](../../server/src/index.ts) — mount at `/api/watchlist-groups`

### Client
- [client/src/types/index.ts](../../client/src/types/index.ts) — new `WatchlistGroup` interface, `groupId` added to `WatchedCard` / `CreateCardPayload` / `UpdateCardPayload`
- [client/src/hooks/useWatchlistGroups.ts](../../client/src/hooks/useWatchlistGroups.ts) — query + 3 mutations
- [client/src/components/shared/WatchlistGroupPicker.tsx](../../client/src/components/shared/WatchlistGroupPicker.tsx) — picker w/ inline create dialog
- [client/src/components/shared/__tests__/WatchlistGroupPicker.test.tsx](../../client/src/components/shared/__tests__/WatchlistGroupPicker.test.tsx) — 8 tests (sentinel uniqueness, ungrouped/group display, disabled propagation, allowCreate on/off, end-to-end create flow)
- [client/src/pages/Watchlist.tsx](../../client/src/pages/Watchlist.tsx) — `GroupSection` component, bucketing render, +New Group header button, Group field added to `CardFormDialog`, per-card picker chip in `CardTile`

## Verification

- [x] Server build clean
- [x] Client build clean
- [x] Server tests: 313/313
- [x] Client tests: 92/92 (was 84 — added 8 picker tests)
- [ ] Hands-on browser test against prod after client deploy: create "High Priority" group → add a card with that group selected → confirm it lands in the High Priority section; on an existing card use the chip to move it; rename + delete the group and confirm cards orphan to Ungrouped, not deleted

## Out of scope (potential follow-ups)

- Drag-to-reorder groups (currently in `sortOrder` insertion order)
- Group colors / icons
- Per-group target-price defaults
- Group picker inside the Collection action sheet (currently Add-to-watchlist defaults to Ungrouped)
- Smart groups (auto-filter by tier, by deal state, etc.)
- Sharing a group as a read-only URL
- Bulk multi-select + "Move to" toolbar action
