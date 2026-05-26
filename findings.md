# Findings — Lot OCR Detection

Research notes for continued development of the Pc vision-AI pipeline.

## Current pipeline (as of 2026-05-23)

**Server**
- `services/lotVisionAi.ts` — Claude `claude-sonnet-4-5` vision over `LotImage.imageUrl`. Cache on `LotImage.ocrText` (reserved JSON column, no migration). Spend cap `OCR_MAX_IMAGES_PER_LOT` (default 12; raised from 6 in 7b7 to cover 12-photo binder lots). Provider gated by `OCR_PROVIDER=claude` + `ANTHROPIC_API_KEY`.
- `services/lotImages.ts` — Lazy fetch via eBay Browse `GET /buy/browse/v1/item/<id>`, persist to `LotImage` `(ebayItemId, position, imageUrl, ocrText)`.
- `routes/lots.ts:349-399` — `POST /api/lots/:ebayItemId/ocr-suggestions`. Idempotent. Returns suggestions with candidates (resolved through `namesToExtracted` → `valueLot`), `cacheStatus`, `imagesProcessed`. 503 when provider disabled.

**Client**
- `LotAnalyzerModal.tsx` — left pane: image gallery from `useLotImages`. Right pane: auto-parsed cards + user-added cards + catalog search picker + "Suggest cards from photos" button (calls `/ocr-suggestions`, accepts chips into addedCards). Notes field + save via `useSaveAnnotation` → `PUT /annotation`.

## Phase 1 baseline 2026-05-26

First live measurement of the pipeline after Phases 2–5 shipped. Driven via curl against prod (`server-production-ad17.up.railway.app`) using a JWT for schploople@gmail.com. Lot picked from the first ≥4-photo result in `/api/lots/search?q=pokemon+lot`. User-supplied test lot.

**Test lot:** `v1|358577296238|0` — 12 photos, Mega-EX collection — https://www.ebay.com/itm/358577296238

**Cold run (`?force=true`)**
- Wall-clock: **32.7s** for 6 images (≈5.4s/image)
- `cacheStatus=fresh`, `imagesProcessed=6` (cap-bound; lot has 12), `imagesFailed=0`, `providerStatus=ok`
- Raw model: 37 suggestions → deduped/merged to 20 surfaced
- `bulkCounts={0,0,0,0}` — model correctly bucketed nothing as bulk (lot is all single Mega-EX cards)
- `usage.imagesProcessed=12, callsMade=3, remaining=88/100` (cumulative across baseline session, two lots)

**Warm run (no force)**
- Wall-clock: **0.68s** (≈48× speedup)
- `cacheStatus=cached`, `imagesProcessed=0`, identical suggestion set (deep diff confirmed)

**Railway server log (one line per cold run, no failures):**
```
[lotVisionAi] ebayItemId=v1|358577296238|0 6 images → 37 suggestions (6 fresh / 0 cached / 0 failed, status=ok)
```
No `[lotVisionAi] image position=N failed:` or `recordOcrCall failed:` lines during the run.

**Accuracy (hands-on compare against the 12-photo listing):** 19/20 correct = **95%**. One soft miss: `omastar` (qty=1, pos=0, conf=0.9) — the actual card is *Omastar V*. Losing the "V" suffix matters: V cards are $20+ vs base Omastar ~$1, so this lot's auto-valuation under-prices by ~$19 on that line. The remaining 19 names + Mega-EX prefixes were all correct.

**New gaps observed (extending G1–G5)**
- **G6 — 6-image cap silently drops half the lot's photos.** `OCR_MAX_IMAGES_PER_LOT=6` is a server-wide env knob, set to keep cost at ~$0.018/run. On 12-photo listings the user gets coverage of photos 0–5 only and has no signal that 6 more were skipped. Worth either (a) raising the cap, (b) making it user-tunable, or (c) at minimum surfacing "processed 6 of 12 photos" in the UI. Filed as bead.
- **G7 — Post-dedupe duplicates leak through.** Three suggestions appeared **twice** with identical `(name, sourceImagePosition, quantity)` tuples: `mega manectric ex` (pos=1, qty=2), `mega gardevoir ex` (pos=3, qty=2), `mega absol ex` (pos=3, qty=2). `dedupeSuggestions` in `lotVisionAi.ts` doesn't catch the merge case where the same (name, pos) is emitted by two separate model passes over the same image. Filed as bead.
- **G8 — `sourceImagePosition: null` slips through validation.** `mega mawile ex` came back with `pos=null`. The schema in `lotVisionAi.ts` should require non-null position. Minor — flagging only, no bead yet.
- **G1 hint-attachment** (already filed in Phase 2 work) is also visible here in microcosm: the Omastar miss is exactly the kind of case where a `cardNumber` hint from the card text in the photo would have pinned the right printing.

**Sanity-checked previous gaps**
- G2 (test coverage): closed by Phase 3 (1hu).
- G3 (OCR doesn't feed feed): closed by Phase 4 (0vd) — `lotUpdate` field is in the response.
- G4 (no spend telemetry/quota): closed by Phase 5 (3om) — `usage` field reports `callsMade`, `cap`, `remaining`; per-user daily cap enforced server-side.
- G5 (cache-key by position not URL hash): still a known limitation, no occurrences in this baseline.

**Conclusion.** Pipeline is production-stable. Latency (~5s/image), cache semantics, telemetry, and provider health are all behaving exactly as designed. The two new gaps (G6 image cap, G7 dedupe leak) are real product issues but low-severity — neither blocks anything, both have clean fix paths. Accuracy at 95% on a high-quality 12-photo Mega-EX lot is the headline number to beat in any future tuning round.

## Gaps identified

### G1 — Hints surface but don't narrow candidates
`lotVisionAi.ts:32-37` declares `setHint` and `cardNumber` on `VisionSuggestion`. Route hands suggestions to `namesToExtracted` keyed by name+quantity+confidence only (`routes/lots.ts:368-374`). The hints get re-attached *after* candidate resolution (`routes/lots.ts:380-388`) as cosmetic chips — they don't filter the candidate list. Effect: a vision-confident "Charizard / Base Set / 4/102" still resolves to dozens of unrelated Charizards.

### G2 — Test coverage thin
`__tests__/lotVisionAi.test.ts` only covers `dedupeSuggestions`. `parseModelOutput`, `coerceSuggestion`, and `runLotVision` are untested. The Anthropic SDK is easy to stub via `vi.mock("@anthropic-ai/sdk")`.

### G3 — OCR results don't feed the lot feed
Vision-derived names live only in `LotImage.ocrText` (per-image cache) and the modal's session state. `Lot.parsedCards` is set once by the title-extractor in `searchAndParseLots` (`routes/lots.ts:104-117`). A lot whose title is "100 Card Lot" stays UNSCORED in the feed even after vision identifies five chase cards. Lots tier/score should reflect the OCR view once it's run.

### G4 — No spend telemetry / no quota
Anthropic vision is ~$0.003/image. Today nothing tracks per-user usage, and any logged-in user can spam `/ocr-suggestions` against lots they didn't fetch (it processes by ebayItemId). Need an `OcrUsage` daily aggregate + soft cap.

### G5 — Cache-key fragility
`LotImage.ocrText` cache is keyed by image position, not image URL hash. If eBay rotates the image at position 1, the cached JSON still replays. Probably acceptable (eBay item IDs are stable, images don't shift positions in practice) — flag as a known limitation, not a blocker.

## External constraints

- Anthropic vision pricing: ~$0.003 per image (Sonnet 4.5). Cap default 6 images/lot ≈ $0.018/run.
- pokemontcg.io rate-limited but local `Card` table covers everything we need (20,359 rows synced weekly).
- eBay Browse API: lot images already cached, no additional rate-limit pressure from this work.

## Decisions

- **Per-user, not shared annotations** (confirmed with user). Same applies to OCR-derived persisted Lot updates — they're shared (everyone benefits), but human additions stay private in `LotAnnotation`.
- **Hints filtering should be soft** — if no candidate matches the setHint, fall back to the unfiltered list rather than dropping the suggestion entirely.
- **Cost cap is server-wide via env**, not per-user-configurable. Simpler v1.

## Open questions

- Should OCR auto-run on the highest-value lot from each search (instant tier upgrade) or stay strictly user-triggered? Currently strict opt-in; v1 keeps that.
- Confidence threshold: today we show every suggestion. Worth a slider (UI) once volume grows.

## References

- `SESSION_RECAP.md` — full project context (note: open-question section is stale, lot annotation already shipped in commit d522b1d)
- `prisma/schema.prisma:273-387` — Lot / LotAnnotation / LotImage models

---

## Pick-printing feature design (Phase 8)

**Problem.** AI vision occasionally identifies a card's *name* correctly but guesses the wrong *set*. The server's `valueLot` resolves `candidates[0]` as the de-facto pick when the user clicks "+ accept" on a chip → wrong printing → wrong valuation. Concrete: Mew VMAX 269/264 (Fusion Strike alt-art SR, ~$215) → AI guessed Sword & Shield base printing (~$15). Lot value off by an order of magnitude.

**UX shape.** Each AI chip gets a `⋯` dropdown (the affordance is drawn in the screenshot but not currently wired). Menu items:
- **Pick correct printing…** → opens a Radix popover anchored to the chip
- **Dismiss suggestion** → disabled stub for a later issue

Popover lists every candidate already on the suggestion payload (server's `valueLot` puts them there — no API call needed). Each row: `setName · year · #number · $market`. The first candidate gets an `AI` badge so the user sees what they're overriding. Click → annotation save → lot revalues with supersession applied.

**Why the candidates are already there.** `LotSuggestion` (client type at `client/src/types/index.ts:252`) carries `candidates: LotCandidatePrinting[]`, populated by `valueLot` in `server/src/services/lotValuation.ts` and returned by `POST /api/lots/:id/ocr-suggestions`. The picker is pure presentation over data the client already has.

**Server-side: name-based supersession.** Issue `dgc` lifted `reValueWithAnnotation` out of `routes/lots.ts` into `services/lotValuation.ts` and changed the math: auto totals are now recomputed from `Lot.parsedCards` JSON per-name instead of read from the cached `lot.lowEstimate`/`lot.highEstimate` scalars. For each parsed name, sum `(min market across candidates) × quantity` for low, max for high — *but skip any name that matches the resolved `Card.name` of a user-added card*. The user's explicit pick replaces the AI's guess; no double-counting.

Why this matters: without supersession, when the user picks the alt-art Mew (`$215`), the lot value becomes `$15 (auto base) + $215 (added)` = `$230`. With supersession, the auto Mew Vmax contribution drops, and the lot value is just `$215`. Tests in `server/src/services/__tests__/reValueWithAnnotation.test.ts` cover the core case and edge cases (case-insensitive name match, unknown cardId, partial supersession when other parsed cards remain).

**Persistence scope.** Per-lot only via `LotAnnotation.addedCards` — the same path that already serves "Your additions". No new schema, no migration. The corrected pick is just an `addedCard` entry with the user's chosen `cardId`.

**Sub-issue split (5 beads, 1 more pending for picker component test).**
- `dgc` ✓ server supersession
- `fqi` ✓ server tests
- `ey5` ◐ PrintingPicker presentational component (the picker itself)
- `3z1` ○ wire the `⋯` menu to the picker on `SuggestionChip` (depends on ey5)
- `36g` ○ client integration test through the chip (depends on 3z1)
- (new) `test(client): PrintingPicker renders + emits picks` — focused unit test on the picker in isolation (depends on ey5)

**Out of scope (deliberate YAGNI).**
- Free-text editing of setHint / cardNumber (the picker covers the common case)
- Renaming the card itself (different problem; the AI's name is usually right)
- Cross-lot correction memory (per-lot scope keeps the surface tiny)
- Persisting "Dismiss suggestion" (menu stays as a disabled stub)
- Search for printings not in the local catalog (the modal already has a catalog search at the bottom)

## Railway deploy lessons (Phase 7)

- **Service-instance overrides set via GraphQL don't reliably apply to redeploys.** Setting `rootDirectory`, `railwayConfigFile`, `buildCommand`, `startCommand` via `serviceInstanceUpdate` worked at the service-config level but `railway redeploy --from-source` kept inheriting the previous deployment's manifest. Only `railway up` reads fresh service config; for monorepo services that need to isolate from a shared root config, `railway up <subdir> --path-as-root --service <name>` is the way.
- **NODE_ENV=production at the service level kills devDeps at build time.** The pattern of "move each build-time devDep into deps" doesn't scale; one structural fix in `railway.json` (prefix install with `NODE_ENV=development … --force`) covers all of them at once.
- **pnpm 9 + non-interactive CI silently skips a destructive reinstall prompt** instead of erroring. Use `--force` to bypass.
