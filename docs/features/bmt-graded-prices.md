# bmt — C2: Graded card price tracks (PSA 9/10, BGS 9.5)

**Bead:** `tcg-card-sniper-dev-bmt` · **Theme:** C (Trustworthy data signals)
**Status:** ✅ shipped
**Migration:** `20260526000140_sold_comp_grade_label`

## What it does

The Sold Comps tab in the card drawer used to mix every sold listing — a PSA 10 sold at $400 sat in the same headline median as a raw NM at $40. C2 mines the specific grade out of the title and splits the comps into per-grade tracks:

- **By grade** breakdown card right under the headline: one row per grade ("PSA 10", "PSA 9", "BGS 9.5", etc) with median, count, and low–high range, sorted by median desc
- Per-row badges now show **"PSA 10"** instead of the generic **"GRADED"** when the grade was parseable; falls back to "GRADED" for legacy data or ambiguous titles

No new data source — we already collect sold comps via ScrapingBee + the Finding API fallback (C1, l6x). C2 just adds a regex pass over the title.

## How it works

1. **Extraction:** `extractGradeLabel(title)` in `server/src/services/soldComps.ts` runs a single regex over each sold-listing title at write time. Bounded grader list (`PSA|BGS|CGC|SGC|ACE|GMA`) + bounded score whitelist (`10, 9.5, 9, 8.5, ... 1`) avoids false positives on year numbers / set numbers. Output is canonical-cased: `"PSA 10"`, `"BGS 9.5"`.
2. **Storage:** new nullable `SoldComp.gradeLabel String?` column with composite index `(cardId, gradeLabel)`. Migration also includes a Postgres-regex backfill UPDATE for existing GRADED rows (no-op today — table was empty when shipped).
3. **Aggregation:** `summariseByGrade(rows)` groups rows by `gradeLabel`, computes per-grade median/low/high/count, sorts desc by median. Rows without a gradeLabel are skipped.
4. **Route:** `GET /api/cards/:id/sold-comps` now includes a `byGrade: GradeBreakdown[]` field alongside the existing `summary` + `rows`.
5. **UI:** `SoldCompsPanel` renders the breakdown card between the headline summary and the per-row list. Hides itself when `byGrade.length === 0`. Per-row condition badge prefers `gradeLabel ?? conditionGrade`.

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `SoldComp.gradeLabel` + `@@index([cardId, gradeLabel])`
- [prisma/migrations/20260526000140_sold_comp_grade_label/migration.sql](../../prisma/migrations/20260526000140_sold_comp_grade_label/migration.sql)
- [server/src/services/soldComps.ts](../../server/src/services/soldComps.ts) — `extractGradeLabel`, `summariseByGrade`, persistence wiring
- [server/src/services/__tests__/soldComps.test.ts](../../server/src/services/__tests__/soldComps.test.ts) — 13 new test cases
- [server/src/routes/cards.ts](../../server/src/routes/cards.ts) — `byGrade` in response
- [client/src/hooks/useSoldComps.ts](../../client/src/hooks/useSoldComps.ts) — `GradeBreakdown` type
- [client/src/components/shared/SoldCompsPanel.tsx](../../client/src/components/shared/SoldCompsPanel.tsx) — breakdown card + per-row label
- [client/src/components/shared/__tests__/SoldCompsPanel.test.tsx](../../client/src/components/shared/__tests__/SoldCompsPanel.test.tsx) — 3 new test cases

## Verification

- [x] Server build clean (strict tsc)
- [x] 304/304 server tests (was 291) — 13 new across `extractGradeLabel` + `summariseByGrade`
- [x] Client build clean
- [x] 65/65 client tests (was 62) — 3 new for the breakdown panel + per-row label
- [x] Migration applied on prod (column + index; backfill UPDATE was no-op against empty SoldComp table)
- [ ] Hands-on prod test: open a watched card, refresh Sold Comps tab, confirm `byGrade` rows render when graded sold listings exist; verify per-row badge shows specific grade ("PSA 10") instead of "GRADED"

## Known limitations / follow-up

- **`fix+feat:` compound type** isn't surfaced anywhere — just a note for the changelog regex.
- **No PSA pop-report integration.** Population / scarcity is a separate signal; would require paid PSA API. Defer until needed.
- **No per-grade price history.** Trend charts would need PriceSnapshot to grow a `grade` dimension + a new daily snapshot tier. Defer — the rolling 90-day median is enough for v1.
- **Graded prices don't yet feed the deal-score waterfall.** If a listing title has "PSA 10", we could compare to the median PSA 10 sold (more accurate than tcgplayer raw market). Bigger blast radius across `dealScore.ts`; tracked as a follow-up bead worth filing once the breakdown panel proves useful.
- **Backfill was a no-op because SoldComp was empty.** New comps from now on populate `gradeLabel` automatically.
