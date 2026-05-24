# A2 — Mis-titled lot detector

**Bead:** `tcg-card-sniper-dev-2bp` · **Theme:** A (Binder intelligence)
**Status:** ✅ shipped & verified
**Migration:** `20260524110000_mistitled_alert_kind`

## What it does

Fires a distinct `MISTITLED` alert when a lot's *photos* contain at least
`$30` worth of cards whose names aren't mentioned in the listing *title*.
This catches the classic "Pokemon card lot" or "estate sale Pokemon
binder" listing that hides a Base Charizard.

Independent from A1 (`LOT_HOT`):
- **A1** fires on "total value ≥ 2× asking" (broad under-pricing)
- **A2** fires on "$30+ of cards not named in title" (title-gap signal)
- A lot can fire both — they're distinct signals, two separate alerts,
  two distinct Discord embeds (purple vs pink)

## Scoring

`computeMistitledScore(input)` in [server/src/services/mistitledScore.ts](../../server/src/services/mistitledScore.ts):

1. Tokenise the lot title (same `tokeniseQuery` helper from B4).
2. For each parsed card in `Lot.parsedCards`:
   - Tokenise the card name.
   - If **any** card-name token appears in the title token set → the card
     is "named" → contributes $0 to hidden value.
   - Else → contributes `(max market across its candidates) × quantity`.
3. Sum everything. Round to cents.

The "any token" rule is intentionally lenient: a title containing
"Charizard" makes both "Charizard" and "Mega Charizard" considered named.
We'd rather miss some borderline hits than spam alerts on every
"M Charizard"-mentions-Charizard lot.

## Fire condition

In `services/lotAlerts.ts.evaluateLotForMistitling`:
- `hiddenUsd ≥ LOT_ALERT_MISTITLED_MIN_USD` (default $30, env-overridable)
- No tier gate — a HOT lot with hidden cards still gets its own MISTITLED alert
- Per-user scoping via `matchUsersForLot` from B4 (no save → no alert)
- Dedup via `Alert_userId_lotEbayItemId_kind` index (unique per kind, so
  the same lot can have one LOT_HOT and one MISTITLED per user)

## Discord embed

`buildMistitledEmbed(input)`:
- Color: `0xe91e63` (pink/magenta) — distinct from LOT_HOT purple and HOT_DEAL orange
- Title: lot title (links to eBay)
- Description: `🕵️ Hidden cards in lot — $X of cards not named in the title`
- Fields (inline): Asking, Hidden value, Title gap multiple
- Field (block): "Cards not mentioned in title" — top 6 hidden cards by total value, `{qty}× {name} ($X)` per line

## In-app drawer

`NotificationDrawer.AlertRow` extended to handle MISTITLED:
- Pink badge: `🕵️ Hidden cards`
- Description: "Vision OCR found valuable cards the title doesn't mention."
- Same "Open lot on eBay" link as LOT_HOT (built from `lotEbayItemId`)

## Architecture

```
After every OCR write-back (auto or user-triggered):

┌─────────────────────────────────────┐
│ routes/lots.ts persistOcrToLot       │
│  upserts Lot row + parsedCards       │
└────────────────┬────────────────────┘
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
┌──────────────┐    ┌────────────────────┐
│ A1 evaluate  │    │ A2 evaluate         │
│ LotAfterOcr  │    │ LotForMistitling    │
│  thresholds  │    │  computeMistitled   │
│  scope users │    │  scope users        │
│  fire LOT_HOT│    │  fire MISTITLED     │
└──────────────┘    └────────────────────┘
       │                   │
       └─────────┬─────────┘
                 ▼
       ┌──────────────────────────┐
       │ Discord webhook fan-out  │ (different embeds per kind)
       └──────────────────────────┘
```

## Schema

```sql
-- 20260524110000_mistitled_alert_kind/migration.sql
ALTER TYPE "AlertKind" ADD VALUE 'MISTITLED';
```

No new tables — reuses Alert.lotEbayItemId from A1.

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `AlertKind.MISTITLED`
- [prisma/migrations/20260524110000_mistitled_alert_kind/migration.sql](../../prisma/migrations/20260524110000_mistitled_alert_kind/migration.sql)
- [server/src/services/mistitledScore.ts](../../server/src/services/mistitledScore.ts) — pure scoring helper
- [server/src/services/lotAlerts.ts](../../server/src/services/lotAlerts.ts) — `evaluateLotForMistitling` + `fanOutMistitledDiscord`
- [server/src/services/discordNotifier.ts](../../server/src/services/discordNotifier.ts) — `buildMistitledEmbed` + `MISTITLED` kind label
- [server/src/routes/lots.ts](../../server/src/routes/lots.ts) — calls both evaluators after `persistOcrToLot`
- [server/src/jobs/autoOcrLots.ts](../../server/src/jobs/autoOcrLots.ts) — same, in the A4 sweep loop
- [server/src/services/__tests__/mistitledScore.test.ts](../../server/src/services/__tests__/mistitledScore.test.ts) — 8 tests
- [client/src/types/index.ts](../../client/src/types/index.ts) — `MISTITLED` in AlertKind union
- [client/src/components/shared/NotificationDrawer.tsx](../../client/src/components/shared/NotificationDrawer.tsx) — pink badge + MISTITLED-specific description

## Verification checklist

- [x] Server build clean (TypeScript strict pass — learned the lesson from B4)
- [x] `pnpm --filter server test` → 248/248 passing (8 new in mistitledScore.test.ts)
- [x] Client build clean + 8/8 tests pass
- [x] Migration applies on prod (`AlertKind` enum gains `MISTITLED`)
- [x] **Hands-on: positive case (2026-05-24)** — saved a SavedLotSearch for "chaos rising" → re-OCR'd the Chaos Rising Floette lot (title says "Mega Floette, M Pyroar, M Gallade, Dragalge ex" but photos contain Mewtwo Ex worth $283, Eternatus Vmax, etc) → 1 MISTITLED Alert row written for my user (lotEbayItemId `v1|168395630021|0`). Distinct from the existing LOT_HOT alerts for the same lot (10 of those from earlier overrides).
- [x] **Hands-on: scoping** — the same OCR call wrote exactly 1 MISTITLED alert (just my user, who has the matching saved search) rather than firing globally — confirmed via DB count + reuse of `matchUsersForLot` from B4. Negative case (no matching save → no alert) is covered by the B4 + A2 unit tests; deployed code path is identical.
- [x] **Hands-on: in-app drawer** — bell drawer renders the MISTITLED row at the top with the pink "🕵️ Hidden cards" badge and the A2-specific description "Vision OCR found valuable cards the title doesn't mention." Below it the matching LOT_HOT row (purple "💎 Under-priced lot") renders independently, proving both kinds fire for the same lot without colliding.

## Future improvements

- Show `mistitledScore` on the lot card in the Lots feed (without firing an alert) so users see the signal even when browsing
- Per-card-rarity weighting (a 1st Edition Holo missing from title is a bigger signal than a common)
- Surface "Title gap: $X" as a tier badge on the Lots tab — could drive lot-discovery without alerts
