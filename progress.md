# Progress — Lot OCR Detection

## Session 2026-05-23 — Planning kickoff

**Mode:** plan (no code changes)

**What happened**
- User asked to plan "continuing TCG Card Sniper work," then narrowed to per-user lot annotation (Pb-next), then to Lot OCR detection specifically.
- Explored project state: SESSION_RECAP.md, prisma/schema.prisma, routes/lots.ts, services/lotVisionAi.ts, services/lotImages.ts, services/cardNameExtractor.ts, services/lotValuation.ts, components/shared/LotAnalyzerModal.tsx, hooks/useCatalog.ts.
- Confirmed Pb-next (lot annotation) shipped in commit `d522b1d`. SESSION_RECAP's open-question section is stale.
- Confirmed the Pc vision-AI/OCR pipeline exists end-to-end and is already wired to the analyzer modal.
- Identified 4 substantive gaps + 1 minor limitation (see findings.md G1–G5).

**Plan written**
- 6 phases: verify baseline → wire hints into candidate filtering → unit tests → persist OCR back to Lot.parsedCards → spend telemetry + cap → verify + recap refresh.
- All phases captured in task_plan.md and the TaskCreate task list.

**Decisions captured**
- Annotations per-user (private). OCR-derived `Lot.parsedCards` updates shared (everyone benefits).
- Soft hint filtering — fall back to unfiltered candidates when no match.
- Spend cap via env, not per-user-configurable in v1.

**Errors**
- None.

**Next step**
- Awaiting user approval (ExitPlanMode). Phase 1 first action: verification baseline against live Railway deployment.

## Session 2026-05-23 (continued) — Phase 3 complete

**What happened**
- Switched task tracking from TaskCreate → beans per user's `beans prime` priming.
- Created epic `TCG Card Sniper-i7vy` + 6 phase beans, wired blocked-by deps (Phase 2→1, Phase 4→2, Phase 6→4+5).
- Picked Phase 3 first (pure local, no creds needed, builds safety net for Phase 2).
- Exported `parseModelOutput`, `coerceSuggestion`, `RawCard` from `lotVisionAi.ts` (no behaviour change).
- Grew `lotVisionAi.test.ts` from 3 tests → 26 tests covering parsing edge cases, coercion clamping, `visionEnabled`, and a fully mocked `runLotVision` (Prisma + Anthropic SDK).
- Server suite: 164/164 passing (was 163).
- Closed bean `TCG Card Sniper-b2ct` with a Summary of Changes block.

**Errors**
- None.

**Next step**
- Phase 2 — wire setHint/cardNumber into candidate resolution. Bean `TCG Card Sniper-eiog`.

## Session 2026-05-23 (continued) — Phase 2 + Phase 4 complete

**Phase 2 — Hint-aware candidate resolution**
- `ExtractedName` gained optional `setHint` / `cardNumber`.
- `namesToExtracted` threads hints from vision-AI.
- `valueLot` calls new `applyHints(bucket, setHint, cardNumber)` helper with **soft fallback** (empty filter result → unfiltered bucket).
- `cardNumber` strips `/N` denominator so `4/102` matches `Card.number === "4"`.
- `setHint` uses forward-only substring containment (catalog must contain hint).
- Route `POST /ocr-suggestions` passes hints in; UI-chip re-attach realigned by name (was unsafe index alignment).
- 8 new tests, 172/172 passing.

**Phase 4 — Persist OCR results into Lot.parsedCards**
- Route now calls `persistOcrToLot` after returning suggestions. Refreshes `parsedCards` / `lowEstimate` / `highEstimate` / `lotScore` / `lotTier` / `parsedAt`.
- Response gained `lotUpdate: { before, after }` for UI feedback ("tier upgraded HOT").
- New pure helper `mergeTitleAndVisionParsed(titleJson, vision)` — union by lowercased name, vision wins on quantity/confidence + contributes hints.
- `LotAnnotation` untouched.
- 7 new tests, 179/179 passing. TypeScript clean.

**Status**
- 3 of 6 OCR phases complete in-session (Phases 2, 3, 4).
- Phase 1 (live verify), Phase 5 (telemetry + DB migration), Phase 6 (closeout) still pending.

**Errors**
- One mid-flight test failure: bidirectional `setName.includes`/`hint.includes` matched too loosely (`"Base Set"` hint matched the more-specific `"Base Set 2"` catalog row). Switched to forward-containment only.

**Next step**
- Awaiting user direction: continue with Phase 5 (DB migration territory), verify in browser (Phase 1), or commit + deploy what's done.

---

## Session 2026-05-23 (later) — Railway fixes + "pick correct printing" feature kickoff

**Mode:** execute (committed work)

**Part A — Railway build/deploy fixes (Phase 7)**

Triaged failing server and client deploys. Single root cause across multiple symptoms: Railway sets `NODE_ENV=production` on both services, which makes `pnpm install --frozen-lockfile` skip every devDependency. Build fell over in successive attempts:
- First on `prisma` CLI → patched in 8e034cd (move to deps)
- Then on `tsc` → patched in 8a51aef (move typescript to deps)
- Then on `@types/node` → would have been next devDep, etc.

Final structural fix in `railway.json` buildCommand: prefix the install with `NODE_ENV=development pnpm install --frozen-lockfile=false --force` (commit 6e5866d). `--force` is the load-bearing flag — without it, pnpm sees the existing prod-only `node_modules` from Nixpacks' stage-7 auto-install and prompts "reinstall from scratch?", which in non-interactive Railway logs silently no-ops.

Server: ✓ deploying, healthchecks pass, server running on port 8080.

Client had an entirely different problem: it was being deployed using the root `/railway.json` (server's config) regardless of any per-service overrides. Setting `rootDirectory`, `railwayConfigFile`, `buildCommand`, and `startCommand` on the service via the GraphQL `serviceInstanceUpdate` mutation took effect in the service config but every subsequent deploy STILL resolved the manifest from root `/railway.json`. Worked around by deploying with `railway up ./client --path-as-root --service client` — `--path-as-root` makes only `client/` the build context, so the root `railway.json` simply isn't there to confuse the deployer.

Client: ✓ serving HTTP 200 at https://poke-sniper.up.railway.app/.

Issues closed: `tcg-card-sniper-dev-nf4` (server), `tcg-card-sniper-dev-tdj` (client). Commits e19421a / f25ce2d range.

**Part B — "Pick correct printing" feature design (Phase 8)**

User flagged that the AI sometimes misidentifies a card's set (Mew VMAX 269/264 Fusion Strike alt art → AI guessed Sword & Shield base). Designed a small UX addition: each AI chip's `⋯` dropdown gets a "Pick correct printing" action that opens a popover listing all candidates already on the suggestion payload. User clicks → cardId is added to `LotAnnotation.addedCards` (existing pattern).

Key insight from exploration: the candidates are already on every suggestion (server's `valueLot` puts them there), so no API call is needed to populate the picker. The non-trivial server change is preventing double-counting: if a user picks a printing for a card the AI already auto-resolved, the AI's contribution must be dropped from the auto value. Solved via "name-based supersession" — when computing the auto total from `Lot.parsedCards`, skip any entry whose name matches a user-added `Card.name`.

Plan saved at `~/.claude/plans/we-need-to-continue-snoopy-reddy.md`. 5 beads issues filed with dependencies: dgc → fqi (server); ey5 → 3z1 → 36g (client).

**Completed today (Phase 8)**
- `dgc` ✓ — lifted `reValueWithAnnotation` + `bestSingleMarket` from `routes/lots.ts` into `services/lotValuation.ts`, added supersession logic. Commit e19421a.
- `fqi` ✓ — 6 unit tests for the supersession behavior (core case, partial, baseline, case-insensitive, unknown cardId, missing lot). Commit 224acc8. Server suite: 200/200 (was 194).

**In progress**
- `ey5` ◐ — `PrintingPicker` popover component.

**Discoveries / errors logged in task_plan.md errors table**
- `bd close` doesn't write back to JSONL; use `bd update --status=closed` instead.
- Railway's `--from-source` redeploys reuse the previous deployment's manifest snapshot, NOT the current service config — `railway up` is needed to pick up service-level changes.
- pnpm 9 in non-interactive mode silently skips the "reinstall from scratch?" prompt; use `--force` to bypass.

**Next step**
- Implement `ey5` (PrintingPicker component) and file a sixth bead for its component test.

---

## Session 2026-05-23 (final) — Phase 8 complete + browser verification

**Mode:** execute (committed + deployed + verified)

**Closed today (Phase 8 wrap)**
- `ey5` ✓ — PrintingPicker popover component (Radix popover + AI badge + price column + empty state). Commit 4881184.
- `3z1` ✓ — wired ⋯ trigger on SuggestionChip; added pickedCardIdByName state, handlePickPrinting, handleSearchFromSuggestion in the parent. Commit 4e70f39. Deviated from spec: dropped the proposed inner DropdownMenu (Pick + Dismiss) in favor of ⋯ directly opening the picker — one fewer Radix dep, one fewer click, Dismiss was a stub anyway.
- `ex4` ✓ — 5 PrintingPicker unit tests.
- `36g` ✓ — 3 SuggestionChip integration tests through Harness wrapper.

Total Phase 8: 6 beads, 200 server tests + 8 client tests, all green. Plus first client test infrastructure for the project (vitest + react testing library + jsdom). Commit 1e2cc88 lands client tests + regenerated client/package-lock.json (Nixpacks' npm ci was out of sync after the radix-popover add).

**Browser verification at https://poke-sniper.up.railway.app/**

Used the claude-in-chrome MCP to drive a real browser session:
1. Searched the Lots tab for "pokemon mew vmax alt art lot" → 5 results.
2. Opened "pokemon card lot all VMAX alt art cards" (the Gardevoir/Sylveon lot — chose this because the original Mew lot's OCR cache came back empty for unrelated reasons).
3. Clicked Suggest cards from photos → 7 AI chips rendered: Kingler Vmax, Gardevoir Vmax, Regieleki Vmax, Sylveon Vmax, Metagross Vmax, Greedent Vmax, Duraludon Vmax. Each chip showed the ⋯ button on its right edge as designed.
4. Clicked Gardevoir Vmax chip body (first attempt landed on body) → chip flipped green ✓ and added swsh35-17 to Your additions. Confirmed the fast-accept path works.
5. Clicked the ⋯ button on the now-accepted Gardevoir Vmax chip → picker popover opened with the header "PICK THE RIGHT PRINTING / Gardevoir Vmax" and 2 candidate rows: Champion's Path · 2020 · #17 · $4.16 ✨AI (badged) and Champion's Path · 2020 · #76 · $15.34.
6. Clicked the #76 row → Your additions instantly transitioned from swsh35-17 to swsh35-76. No double-count. Chip stayed accepted, ⋯ still usable for further changes.

This is the supersession + pick-printing flow working end-to-end against real production data.

**Discoveries / errors logged**
- Client/package-lock.json had to be regenerated after the radix-popover add — Nixpacks' Caddy preset for the client service auto-runs `npm ci` which fails on lockfile drift.
- `bd close <id>` continues to be unreliable for JSONL writes. Confirmed pattern: `bd update <id> --status=closed`, then `bd export > .beads/issues.jsonl`, then commit JSONL, then `bd dolt push`, then `git push`.
- First-time client test run had no infrastructure — added vitest config + setup file + a `test` script in client/package.json. ~5 minutes of one-time setup, unblocks all future client tests.

**Status**
- Pick-printing feature: shipped, verified, tested.
- All 6 Phase-8 beads closed. 18 issues total in the project; 11 closed; 0 in-progress; 0 blocked.
- Session ready to hand off or pivot to Phase 1 (live verification baseline), Phase 5 (telemetry — actually mostly done in the prior session), or Phase 6 (closeout + SESSION_RECAP refresh).

---

## Session 2026-05-26 — OCR epic close-out (mwn, 7b7, ad4)

Continuation of an earlier-in-the-day session that closed 7 stale beads (qi3, ytf, 8ni, bmt, n5f, yam, ex4) — most were features shipped in prior sessions but never marked closed in `bd`. Code already on main; just paperwork.

**Phase 1 baseline (`mwn`)** — first live measurement of the OCR pipeline against prod after Phases 2–5 shipped. Driven via curl against `server-production-ad17.up.railway.app` with a JWT for schploople@gmail.com. Test lot: `v1|358577296238|0` (12 photos, Mega-EX collection).

- Cold run: 32.7s for 6 images (~5.4s/image), `cacheStatus=fresh`, `imagesProcessed=6` (cap-bound), `imagesFailed=0`, `providerStatus=ok`, 20 surfaced suggestions (37 raw → deduped).
- Warm run: 0.68s cached, identical suggestion set (deep diff).
- Server log: clean `[lotVisionAi]` summary, no `image position=N failed` or `recordOcrCall failed` lines.
- Accuracy: **19/20 = 95%** by hands-on compare. One miss: `omastar` should be `omastar v` (lost the "V" suffix — V cards $20+ vs base ~$1).
- Daily-cap telemetry working: `usage.callsMade`, `cap`, `remaining` all reported as designed.

Two new gaps logged in findings.md and filed as beads:
- **G6 → `bd-7b7`** — 6-image cap silently dropped photos 6–11 on the 12-photo lot.
- **G7 → `bd-bo3`** — `dedupeSuggestions` let 3 post-merge duplicates leak through (mega manectric / gardevoir / absol).

**Cap lift (`7b7`)** — bumped `OCR_MAX_IMAGES_PER_LOT` default from 6 → 12 in `server/src/config.ts`; matched Railway env var via `railway variables --set`. Cost goes $0.018/run → $0.036/run worst case; per-user daily cap (100 images) still bounds total spend. Docs refreshed: README, DEPLOYMENT, 0hj-sep, findings.md.

Re-verified against the same lot post-deploy:
- `imagesProcessed: 12` (was 6) — cap fully lifted
- 69.6s wall-clock (~5.8s/image, consistent), 0 failures
- **28 surfaced suggestions** (was 20) — +8 net new cards visible only in photos 6–11

**Phase 6 wrap-up (`ad4`)** — refreshed SESSION_RECAP.md ("Since 2026-05-22" feature waves section, pruned the long-obsolete "Open question — user's next ask" lot-annotation block, bumped tests count 163 → 304+). This entry to progress.md.

**Discoveries**
- `bd close` writes the close to dolt but the next command re-imports from `.beads/issues.jsonl` and undoes it. Fix: pipe `bd close <id> && bd export > .beads/issues.jsonl` in the same shell call. Already documented in earlier sessions but bit again here.
- Railway CLI `railway status --json` doesn't accept `--service`; nested JSON has deployments scattered across the tree. `jq -r '.. | objects | select(.status? and .createdAt?)'` is the working pattern.
- Server prod URL is `server-production-ad17.up.railway.app`, not the client URL. Found via `docs/DEPLOYMENT.md`.

**Status**
- Epic `66f` (Lot OCR detection — productionize beyond MVP): all 6 phases shipped + closed. Epic itself ready to close.
- Stack now at 304 server tests, 65+ client tests, all green. ~50 beads total in project; long tail of legacy scaffold beads (`czk`, `csb`, `610`) likely stale — audit pass next session.
- Top of `bd ready` after this session: `bd-bo3` (dedupe leak, P3), `u8y` (Saved Lots — likely already shipped, audit), `czk/csb/610` (audit + close).
