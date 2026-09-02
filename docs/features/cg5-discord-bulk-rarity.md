# cg5 — Surface A3 bulk-rarity counts in LOT_HOT / MISTITLED Discord embeds

**Bead:** `tcg-card-sniper-dev-cg5` · **Theme:** A (Binder intelligence)
**Status:** ✅ shipped

## What it does

A3 (`yam`) shipped bulk-rarity counts + a low/high valuation band to the
in-app analyzer modal (`BulkValuationPanel.tsx`), but the same data never
made it into the Discord embeds A1/A2 already send. Both `LOT_HOT` and
`MISTITLED` embeds now get an extra field when the vision pass found
unidentified bulk cards:

```
Unidentified bulk
≈ 24 unidentified · $4–$18
```

The field is omitted entirely when there's no bulk data or `totalCards`
is 0 — most lots have nothing left over once the named cards are
accounted for, so this doesn't clutter the common case.

## How it works

`Lot.bulkCounts` doesn't exist as a persisted column — bulk counts are a
byproduct of a single OCR pass (`runLotVision`'s return value), not
Lot-row state. Both places that trigger the LOT_HOT/MISTITLED evaluators
right after an OCR call already have that pass's `BulkCounts` sitting in a
local `result` variable, so `evaluateLotAfterOcr` and
`evaluateLotForMistitling` (`server/src/services/lotAlerts.ts`) grew an
optional third parameter and thread it straight into `valueBulk()`
(A3's existing pure valuator) rather than trying to read it back off the
Lot row.

```
POST /api/lots/:id/ocr-suggestions          autoOcrLots.ts cron
   │  result = runLotVision(...)                │  result = runLotVision(...)
   │                                              │
   ├─ evaluateLotAfterOcr(id, result.bulk)  ◀─────┤
   └─ evaluateLotForMistitling(id, result.bulk) ◀─┘
              │
              ▼
   fanOutDiscord / fanOutMistitledDiscord
              │  valueBulk(bulkCounts) → { totalCards, low, high }
              ▼
   buildLotAlertEmbed / buildMistitledEmbed
              │  totalCards > 0 ? push "Unidentified bulk" field : skip
              ▼
   Discord embed
```

The parameter is optional and defaults to `undefined` everywhere it isn't
threaded (any future caller of the evaluators that doesn't have a fresh
vision result on hand) — the bulk field then just doesn't render, same as
before this change.

## Files

- [server/src/services/discordNotifier.ts](../../server/src/services/discordNotifier.ts) — `bulkValuation?` on `LotAlertEmbedInput` / `MistitledAlertEmbedInput`; the new field in `buildLotAlertEmbed` + `buildMistitledEmbed`
- [server/src/services/lotAlerts.ts](../../server/src/services/lotAlerts.ts) — `bulkCounts?: BulkCounts` param on `evaluateLotAfterOcr` / `evaluateLotForMistitling`, threaded to `fanOutDiscord` / `fanOutMistitledDiscord`, which call `valueBulk()` (reused from A3, no new valuation logic)
- [server/src/routes/lots.ts](../../server/src/routes/lots.ts) — passes `result.bulk` from the OCR route's `runLotVision` call
- [server/src/jobs/autoOcrLots.ts](../../server/src/jobs/autoOcrLots.ts) — passes `result.bulk` from the cron sweep's `runLotVision` call
- [server/src/services/__tests__/discordNotifier.test.ts](../../server/src/services/__tests__/discordNotifier.test.ts) — 6 new tests (`buildLotAlertEmbed`/`buildMistitledEmbed` had no dedicated tests before this — also fills that pre-existing gap): field present/absent/zero-totalCards for both builders
- [server/src/services/__tests__/lotAlerts.test.ts](../../server/src/services/__tests__/lotAlerts.test.ts) — 3 new tests verifying `bulkCounts` reaches the actual Discord payload via `evaluateLotAfterOcr`

## Verification

- [x] Server build (`pnpm --filter server build`) clean
- [x] Server tests: 327/327 (was 319)
- [ ] Hands-on: trigger OCR on a lot listing with visible unidentified bulk cards (either via the analyzer modal's "Refresh AI" or letting the hourly `autoOcrLots` sweep pick it up), confirm the Discord embed shows the "Unidentified bulk" field with a sane count/range, and confirm it's absent on a lot with no bulk cards

## Out of scope (potential follow-ups)

- Web Push payloads (`pushNotifier.ts`) don't carry the bulk line — only Discord embeds were in this bead's scope
- `evaluateLotForMistitling` has no dedicated unit test file yet (pre-existing gap, not introduced by this change) — its bulk threading is covered indirectly via `buildMistitledEmbed`'s own tests
