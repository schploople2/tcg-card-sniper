# Task Plan — Lot OCR Detection: Continued Development

**Goal:** Iterate the Pc Lot vision-AI / OCR card-detection feature beyond its current MVP. The pipeline (Claude Vision over `LotImage` rows, cached on `ocrText`, surfaced via `POST /api/lots/:ebayItemId/ocr-suggestions`) works end-to-end. Next milestones harden, sharpen, and instrument it.

**Repo:** `/Users/johnryan/tcg-card-sniper/TCG Card Sniper`
**Today:** 2026-05-23
**Owner:** John (schploople@gmail.com)

---

## Phases

### Phase 1 — Verification baseline `status: pending`
Confirm the OCR feature works in production today before changing anything.

- Pull a real lot from the prod feed via the running Railway services
- Open the analyzer modal, click "Suggest cards from photos"
- Capture: cacheStatus values across 1st/2nd call, suggestion count vs. truth, latency, any errors in server logs
- Note any UX surprises in `findings.md`

### Phase 2 — Sharpen candidate resolution with setHint + cardNumber `status: complete`
Today vision returns `setHint` and `cardNumber` (`lotVisionAi.ts:32-37`) but the route discards them when resolving candidates (`routes/lots.ts:380-388` — they're re-attached *after* `namesToExtracted` ran, so they don't narrow). Wire these hints into candidate filtering so a "Charizard / Base Set / 4/102" suggestion resolves to that exact printing, not 50 Charizards.

Critical files:
- `server/src/services/cardNameExtractor.ts` (`namesToExtracted`) — add optional `setHint`/`number` to input
- `server/src/services/lotValuation.ts` (`valueLot` / `parsedCards` candidate list) — filter candidates by set name (fuzzy contains) and number (exact) when present
- `server/src/routes/lots.ts:368-388` — pass hints through

### Phase 3 — Unit test coverage for vision parsing `status: complete`
`__tests__/lotVisionAi.test.ts` covers only `dedupeSuggestions`. Add tests for:
- `parseModelOutput`: clean JSON, code-fence-wrapped, prose-prefixed, brace-extracted, malformed → empty
- `coerceSuggestion`: missing fields, "unidentified" reject, quantity clamping, confidence clamping, lowercased name
- `runLotVision` integration: mock `prisma.lotImage` + Anthropic client; verify cache hit replay, cache miss writes back, partial failures don't throw, cap by `OCR_MAX_IMAGES_PER_LOT`

Mirror the mocking pattern used in `alerts.test.ts` for the Prisma side.

### Phase 4 — Persist OCR results into `Lot.parsedCards` `status: complete`
Today vision suggestions live only in the modal session and the per-image `ocrText` cache. The Lot search feed (`GET /api/lots/search`) still shows the title-extractor's parsed cards even for lots where OCR found more. After a successful OCR run, merge vision-derived names into the Lot's `parsedCards` and re-run `valueLot` + `scoreLot` so the lot's tier/estimate reflect what's actually in the photos.

Files:
- `server/src/routes/lots.ts` — extend `POST /:ebayItemId/ocr-suggestions` to write back to `Lot`
- Guard against blowing away annotation overlays (annotations stay in `LotAnnotation`, untouched)

### Phase 5 — Spend telemetry + per-user OCR cap `status: pending`
Vision calls cost ~$0.003/image. Today: no quota, no usage record. Add:
- New `OcrUsage` table: `(userId, day, imagesProcessed, callsMade)` — daily aggregate
- Increment on each `runLotVision` call where `imagesProcessed > 0`
- Soft cap via `OCR_DAILY_IMAGES_PER_USER` env var (default 100). When exceeded → 429 from `/ocr-suggestions` with message
- `GET /api/lots/_admin/ocr-usage` to inspect across users

### Phase 6 — Verification pass `status: pending`
Run the test suite, deploy to Railway, repeat Phase-1 verification with the new behaviours. Update `SESSION_RECAP.md`.

### Phase 7 — Railway build + deploy fixes `status: complete`
Real-world incident that surfaced mid-session: NODE_ENV=production on Railway service env vars caused `pnpm install --frozen-lockfile` to skip all devDependencies, so build phase had no `prisma`, then no `tsc`, then no `@types/node` in successive attempts. The "move build-time devDep to dependencies" pattern (prisma → deps in 8e034cd, typescript → deps in 8a51aef) was whack-a-mole. Final fix in `railway.json` buildCommand: prefix install with `NODE_ENV=development pnpm install --frozen-lockfile=false --force` so devDeps are reinstalled over the Nixpacks step-7 prod-only install (commit 6e5866d).

Client service had a deeper structural problem: it was using the SHARED `/railway.json` (server's config). Even setting `rootDirectory` / `railwayConfigFile` / `buildCommand` overrides via the GraphQL `serviceInstanceUpdate` mutation didn't take effect — Railway kept reading root `/railway.json`. Working fix: set buildCommand/startCommand overrides on the service via API, then deploy with `railway up ./client --path-as-root --service client` so only `client/` is the build context. Client now serving HTTP 200 at https://poke-sniper.up.railway.app/. Issues `tcg-card-sniper-dev-nf4` and `tcg-card-sniper-dev-tdj` closed.

### Phase 8 — "Pick correct printing" UX `status: in_progress`
User reported the AI sometimes misidentifies the *set* a card belongs to even when the name is right (e.g. Mew VMAX 269/264 from Fusion Strike alt-art SR, but AI guessed Sword & Shield base). The auto-resolved candidate is usually wrong → lot valuation is way off. Add UX to pick the right printing from the suggestion's existing `candidates` list.

5 beads issues track the feature (see `findings.md` § "Pick-printing feature design" for the full design):
- `dgc` ✓ — `feat(server): name-based supersession in lot revaluation` (commit e19421a)
- `fqi` ✓ — `test(server): supersession in lot revaluation` (commit 224acc8, 200/200 tests)
- `ey5` ◐ — `feat(client): PrintingPicker popover component` — IN PROGRESS
- `3z1` ○ — `feat(client): per-chip dropdown menu on SuggestionChip` — blocked on ey5
- `36g` ○ — `test(client): picking a non-default printing routes through useSaveAnnotation` — blocked on 3z1
- (new) `test(client): PrintingPicker component renders + emits picks correctly` — to be filed against ey5

End-to-end verification: open the Mew VMAX 269/264 lot at poke-sniper.up.railway.app → click ⋯ on the chip → Pick correct printing → click Fusion Strike alt art row → confirm lot value reflects $215 (not $15 + $215 double-counted).

---

## Key files (cited from exploration)
- `prisma/schema.prisma` — `Lot` (273-322), `LotAnnotation` (343-360), `LotImage` (375-387), `Card` (404-448)
- `server/src/services/lotVisionAi.ts` — vision pipeline + cache
- `server/src/services/lotImages.ts` — eBay image fetch + persist
- `server/src/services/cardNameExtractor.ts` — `namesToExtracted` adapter
- `server/src/services/lotValuation.ts` — `valueLot`, candidate resolution
- `server/src/routes/lots.ts` — annotation + OCR suggestion routes
- `client/src/components/shared/LotAnalyzerModal.tsx` — UI (`useSaveAnnotation`, suggestion chips)
- `client/src/hooks/useCatalog.ts` — `useCatalogSearch` for the picker

## Errors encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Railway server build: `sh: 1: tsc: not found` after `prisma` was moved to deps | NODE_ENV=production made pnpm skip all devDeps including tsc | Use `NODE_ENV=development pnpm install --frozen-lockfile=false --force` in railway.json buildCommand (commit 6e5866d) |
| Railway client build: `rm: cannot remove 'node_modules/.cache': Device or resource busy` | First attempted `rm -rf node_modules` to force fresh install | Switched to `pnpm install --force` which bypasses the issue (commit 6e5866d series) |
| Railway client service ignored `railwayConfigFile` and per-service buildCommand overrides | Set overrides via GraphQL `serviceInstanceUpdate`, redeploys still used root `/railway.json` | Deploy with `railway up ./client --path-as-root --service client` so only client/ is the build context — no stray root config |
| `bd close <id>` does not write back to `.beads/issues.jsonl` reliably | Subsequent `bd` calls re-import stale JSONL and lose the close | Use `bd update <id> --status=closed` instead, which DOES persist to JSONL |
