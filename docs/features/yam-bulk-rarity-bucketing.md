# A3 — Bulk-rarity bucketing

**Bead:** `tcg-card-sniper-dev-yam` · **Theme:** A (Binder intelligence)
**Status:** ✅ shipped

## What it does

The lot vision pass now reports cards visible in the photos but NOT
individually identified by name, bucketed by rarity (commons /
uncommons / rares / holos). The analyzer modal shows a one-line
estimate beneath the AI suggestions:

> 💡 **≈ 17 unidentified cards · $1.85 – $7.45**  *(mid $3.50)*
> 10 commons · 4 uncommons · 2 rares · 1 holo

Eliminates the "OCR found 3 named cards, what about the other 50 in the
binder page?" gap. Turns "I see a Charizard, looks like more cards in
the back" into a full lot valuation.

## How it works

1. **Prompt** ([`lotVisionAi.ts`](../../server/src/services/lotVisionAi.ts)) — extended `SYSTEM_PROMPT` to ask Claude Vision to also count cards by rarity symbol (●/◆/★ + holo finish) for everything it sees but can't read a name on. The model returns `{cards: [...], bulk: {commons, uncommons, rares, holos}}` in a single response — no extra API call.
2. **Aggregation** — `runLotVision` sums `bulk` counts across every processed and cached image into a single `BulkCounts`.
3. **Valuation** ([`bulkValuation.ts`](../../server/src/services/bulkValuation.ts)) — `valueBulk(counts)` multiplies each bucket by industry-standard bulk rates and returns `{totalCards, low, mid, high, byBucket}`.
4. **Response** — `POST /api/lots/:id/ocr-suggestions` includes `bulkCounts` + `bulkValuation` in the JSON body.
5. **UI** ([`BulkValuationPanel.tsx`](../../client/src/components/shared/BulkValuationPanel.tsx)) — renders the headline + per-bucket breakdown. Hides itself when `totalCards === 0`.

## Bulk rates

Per-card rates ([low, mid, high] USD) live in `DEFAULT_BULK_RATES`:

| Rarity | Low | Mid | High |
|---|---:|---:|---:|
| Common | $0.01 | $0.02 | $0.05 |
| Uncommon | $0.05 | $0.08 | $0.15 |
| Rare | $0.25 | $0.50 | $1.00 |
| Holo | $1.00 | $1.50 | $3.00 |

Sourced from r/PokemonTCG dealer consensus + PriceCharting's own "bulk"
band. Overridable per-call via the `rates` arg to `valueBulk(counts, rates)`
— future: expose a user-configurable rate table in Settings.

## Backward compatibility

Existing `LotImage.ocrText` cache entries don't have a `bulk` field.
`coerceBulk` defaults missing/garbage input to all zeros, so cached lots
will show a "no bulk" state until they're re-OCR'd. The next fresh OCR
(either user-triggered or via the `:15` autoOcrLots cron) fills in the
bulk for that lot.

## Files

- [server/src/services/lotVisionAi.ts](../../server/src/services/lotVisionAi.ts) — `BulkCounts` type, `coerceBulk`, `addBulk`, extended prompt + `parseModelOutput`/`parseCachedSuggestions`/`visionOneImage`/`runLotVision`
- [server/src/services/bulkValuation.ts](../../server/src/services/bulkValuation.ts) — new, pure rate-table math
- [server/src/services/__tests__/bulkValuation.test.ts](../../server/src/services/__tests__/bulkValuation.test.ts) — 7 tests
- [server/src/services/__tests__/lotVisionAi.test.ts](../../server/src/services/__tests__/lotVisionAi.test.ts) — 3 new tests for the bulk parse path
- [server/src/routes/lots.ts](../../server/src/routes/lots.ts) — `POST /api/lots/:id/ocr-suggestions` now returns `bulkCounts` + `bulkValuation`
- [client/src/components/shared/BulkValuationPanel.tsx](../../client/src/components/shared/BulkValuationPanel.tsx) — new render
- [client/src/components/shared/LotAnalyzerModal.tsx](../../client/src/components/shared/LotAnalyzerModal.tsx) — wires `bulkCounts` + `bulkValuation` state and mounts the panel under the suggestions
- [client/src/components/shared/__tests__/BulkValuationPanel.test.tsx](../../client/src/components/shared/__tests__/BulkValuationPanel.test.tsx) — 5 tests
- [client/src/types/index.ts](../../client/src/types/index.ts) — `BulkCounts` + `BulkValuation` exported

## Verification

- [x] Server build clean (strict tsc)
- [x] 290/290 server tests (was 280)
- [x] Client build clean
- [x] 39/39 client tests (was 34)
- [ ] Hands-on prod test: open a binder-page lot in the analyzer, click "Suggest cards from photos", confirm the Bulk estimate row renders under the chips with a sensible $ range

## Known limitations / follow-up

- **Cost:** the extended prompt is a few extra output tokens per image, so per-image OCR cost goes up ~$0.0001. Negligible.
- **Accuracy:** counts depend on the model's rarity-symbol recognition; expect ±20% on dense binder pages.
- **No double-counting check:** if the model erroneously bulks a card it also named, the lot's total value is slightly inflated. Trust the model's "do not double-count" instruction; verify if it becomes noticeable.
- **User-configurable rates:** future Settings page entry. v1 ships with the defaults.
- **Auto-OCR doesn't re-evaluate alerts on bulk:** A1's `evaluateLotAfterOcr` only fires on lot.lowEstimate/highEstimate from `valueLot(parsedCards)`. The bulk valuation lives in a separate field and isn't summed in. A follow-up could roll bulk into the alert thresholds (e.g. "named hits + bulk ≥ 2× listing price → fire").
