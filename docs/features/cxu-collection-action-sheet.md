# cxu — Collection action sheet (mark collected · add to watchlist)

**Bead:** `tcg-card-sniper-dev-cxu` · **Theme:** Collection · **Builds on:** [hpx](hpx-radiant-collection.md)
**Status:** ✅ shipped

## What it does

On `/collection`, **tap a card** to open a small action sheet that exposes both:
- **Mark as collected / Mark as not collected** — toggles the `CollectionEntry` row exactly like before
- **Add to watchlist (holofoil)** — creates a `WatchedCard` at the default variant (holofoil if present on the card, else the first available)

When the user already watches the card+variant pair, the Add button is disabled and reads **Already in watchlist**. When the card has no TCGPlayer variants at all (rare — alt-arts in this subset are uncommon but possible), the Add button reads **No TCGPlayer variants** and is disabled.

The sheet is a Radix Dialog at `max-w-sm` showing the card thumbnail, name, set + number, then the two action buttons stacked. Backdrop dismisses; Escape dismisses; both action handlers also close on completion (`onSettled` for Add, instantly for Toggle).

## Why an action sheet (vs the previous tap-toggle)

Two actions, one gesture surface. Long-press isn't discoverable on mobile. Dual-icon tiles (one ✓, one +) clutter the gallery and don't scale to a third action later. The sheet adds one tap to "mark collected" but makes both surfaces discoverable for new users.

## Architecture

```
/collection page
   │
   ├── tile.onClick(card)  ──▶  setActiveCard(card)  ──▶  <CollectionActionSheet card={activeCard} … />
   │
   └── useCards() ──▶ watchedIndex (Set<"<cardId>|<variant>">)
                       │
                       └── isAlreadyWatching(card) ──▶ alreadyWatching prop
```

Server: `GET /api/collection/radiant` now also returns each card's `variants: string[]` so the client can compute the default variant without a second fetch.

Default-variant rule lives in `pickDefaultVariant(variants)` inside `CollectionActionSheet.tsx`:
1. `[]` → null (Add disabled with "No TCGPlayer variants")
2. Contains `"holofoil"` → `"holofoil"`
3. Otherwise → `variants[0]`

## Files

- [server/src/routes/collection.ts](../../server/src/routes/collection.ts) — added `variants` to the select + the `RadiantCardRow` type
- [server/src/routes/__tests__/collection.test.ts](../../server/src/routes/__tests__/collection.test.ts) — fixture updated with `variants`
- [client/src/components/shared/CollectionActionSheet.tsx](../../client/src/components/shared/CollectionActionSheet.tsx) — new component + `pickDefaultVariant` helper
- [client/src/components/shared/__tests__/CollectionActionSheet.test.tsx](../../client/src/components/shared/__tests__/CollectionActionSheet.test.tsx) — 11 tests (variant pick rules, render states, button labels, disabled paths)
- [client/src/pages/Collection.tsx](../../client/src/pages/Collection.tsx) — wires `useCards`, `useCreateCard`, `useToggleCollection`; tile `onClick` opens the sheet instead of mutating
- [client/src/pages/__tests__/Collection.test.tsx](../../client/src/pages/__tests__/Collection.test.tsx) — updated to assert sheet-opening + sheet-routed mutations + already-watching disabled
- [client/src/hooks/useRadiantCollection.ts](../../client/src/hooks/useRadiantCollection.ts) — added `variants: string[]` to `RadiantCard`

## Verification

- [x] Server build clean
- [x] Client build clean
- [x] Server tests: 313/313
- [x] Client tests: 84/84 (was 70 — added 3 to Collection.test + 11 to new ActionSheet.test)
- [ ] Hands-on browser test against prod: tap a card → sheet opens; Mark collected toggles; Add to watchlist creates a WatchedCard at holofoil; navigate to /watchlist and confirm the row appears; return to /collection, tap the same card, confirm Add button shows "Already in watchlist"

## Out of scope (potential follow-ups)

- Variant picker inside the sheet (currently auto-picks holofoil)
- Target-price input inside the sheet (uses the server's default — no target)
- Bulk-add ("add all uncollected to watchlist")
- "Already collected" filter / hide-collected toggle
