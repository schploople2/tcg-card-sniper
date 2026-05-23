# Findings — Lot OCR Detection

Research notes for continued development of the Pc vision-AI pipeline.

## Current pipeline (as of 2026-05-23)

**Server**
- `services/lotVisionAi.ts` — Claude `claude-sonnet-4-5` vision over `LotImage.imageUrl`. Cache on `LotImage.ocrText` (reserved JSON column, no migration). Spend cap `OCR_MAX_IMAGES_PER_LOT` (default 6). Provider gated by `OCR_PROVIDER=claude` + `ANTHROPIC_API_KEY`.
- `services/lotImages.ts` — Lazy fetch via eBay Browse `GET /buy/browse/v1/item/<id>`, persist to `LotImage` `(ebayItemId, position, imageUrl, ocrText)`.
- `routes/lots.ts:349-399` — `POST /api/lots/:ebayItemId/ocr-suggestions`. Idempotent. Returns suggestions with candidates (resolved through `namesToExtracted` → `valueLot`), `cacheStatus`, `imagesProcessed`. 503 when provider disabled.

**Client**
- `LotAnalyzerModal.tsx` — left pane: image gallery from `useLotImages`. Right pane: auto-parsed cards + user-added cards + catalog search picker + "Suggest cards from photos" button (calls `/ocr-suggestions`, accepts chips into addedCards). Notes field + save via `useSaveAnnotation` → `PUT /annotation`.

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
