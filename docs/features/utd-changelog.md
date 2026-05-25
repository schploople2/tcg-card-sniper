# utd — Auto-generated `CHANGELOG.md`

**Bead:** `tcg-card-sniper-dev-utd` · **Theme:** DX / project hygiene
**Status:** ✅ shipped

## What it does

The repo now has a single source of truth for "what shipped, when" — `CHANGELOG.md` at the repo root. Entries are generated from conventional commits by a small Node script and refreshed on demand with `pnpm changelog`.

User-visible types only:
- `feat:` → **Added** section
- `fix:` → **Fixed** section
- everything else (`build`, `chore`, `test`, `docs`, `refactor`, `bd`, etc) is silently dropped

Sections are grouped by **UTC date** (no semver / no tags — single-developer repo). Each commit line preserves the conventional-commit `scope:` as a bold prefix and keeps any trailing `(bead-id)` parenthetical intact.

## How it stays current

1. `CHANGELOG.md` carries a marker comment near the top:
   `<!-- changelog-marker: <last-processed-sha> -->`
2. `pnpm changelog` reads that SHA, runs `git log <sha>..HEAD --format='%H\t%aI\t%s'`, parses subjects, prepends new sections, and bumps the marker to `HEAD`.
3. Workflow rule (documented in `CLAUDE.md` and `docs/DEPLOYMENT.md`): **run `pnpm changelog` before pushing** and commit the updated `CHANGELOG.md` alongside the change.

The script is idempotent — re-running with no new commits prints `[changelog] already up to date (marker at HEAD)` and exits.

If the marker SHA doesn't exist in the current checkout (rebase, force-push), the script warns and rebuilds from the entire history.

## Files

- [scripts/changelog.mjs](../../scripts/changelog.mjs) — runner (git IO + file write)
- [scripts/changelog-format.mjs](../../scripts/changelog-format.mjs) — pure formatter (parse → group → render)
- [scripts/__tests__/changelog-format.test.mjs](../../scripts/__tests__/changelog-format.test.mjs) — 14 `node --test` cases
- [CHANGELOG.md](../../CHANGELOG.md) — generated output
- [package.json](../../package.json) — `pnpm changelog` + `pnpm changelog:test` scripts
- [CLAUDE.md](../../CLAUDE.md) — convention note pointing to the script
- [docs/DEPLOYMENT.md](../DEPLOYMENT.md) — added "refresh changelog" to the pre-push checklist
- [README.md](../../README.md) — link to CHANGELOG.md

## Verification

- [x] Initial backfill produced 37 entries across two dated sections (2026-05-25 + 2026-05-24)
- [x] Re-running `pnpm changelog` is a no-op
- [x] `pnpm changelog:test` passes (14/14)
- [x] Manual review of generated CHANGELOG — no `build:` / `chore:` / `bd:` leakage, scopes preserved, bead-id parentheticals intact

## Known limitations / follow-up

- **No in-app surface yet.** The CHANGELOG.md is repo-only. A "What's New" modal + bell badge for unseen entries is documented as out-of-scope but a natural next step.
- **`fix+feat:` compound type isn't recognized.** Drops to null rather than rendering twice. We've used it once (`fix+feat(lots): per-chip identity + thumbnails`); to be safe, split future cross-cutting changes into separate commits.
- **No bead-id auto-linking.** `(yam)` etc render as plain text rather than `[yam](#)` deep links. Easy add later via a regex pass over the rendered output.
- **No semver / git tags.** Date sections only. Add tags + a `## [vX.Y.Z]` header style if the project ever ships to a public audience.
