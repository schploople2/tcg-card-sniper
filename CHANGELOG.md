# Changelog

All notable user-visible changes to TCG Card Sniper. Generated from
conventional commits — run `pnpm changelog` to refresh from git.

<!-- changelog-marker: 56ba44971d58d8536fb1b3daf90dcf0b79fbd288 -->

## 2026-05-26

### Fixed
- **ocr:** close two duplicate-leak holes past dedupeSuggestions (bo3)

## 2026-05-26

### Added
- **ocr:** raise per-lot image cap 6 → 12 (7b7)

## 2026-05-25

### Added
- **comps:** C2 — graded card price tracks (PSA 9/10, BGS 9.5) (bmt)

## 2026-05-25

### Added
- **dx:** auto-generated CHANGELOG from conventional commits (utd)

## 2026-05-25

### Added
- **ux:** clicking saved-lot title opens the analyzer (u8y polish)
- **ux:** in-app image lightbox for lot analyzer photos (n5f)
- **lots:** live 'Lot price vs market' headline panel
- **lots:** refresh-AI affordance for legacy OCR cache missing bulk data
- **lots:** rehydrate AI suggestions + bulk panel on modal reopen
- **lots:** u8y — saved lots pinned to a new Saved tab
- **lots:** A3 — bulk-rarity bucketing for unidentified cards (yam)

### Fixed
- **ux:** backdrop click closes image lightbox (n5f follow-up)
- **lots:** make per-chip key truly unique by including render index (ytf)
- **ux:** scroll the whole right pane of LotAnalyzerModal (qi3 follow-up)
- **ux:** cap AI-suggestion chip grid height so right pane stays reachable (qi3)

## 2026-05-24

### Added
- **comps:** C1 — true sold-comps panel on card drawer (l6x)
- **push:** B2 — web push notifications for all 5 alert kinds (rcs)
- **D2:** also evaluate WatchedSeller in the GET /listings/:cardId path
- **D2:** watch this seller — SELLER_LISTING alerts on listings from saved sellers (d5x)
- **A2:** mis-titled lot detector — pink MISTITLED alert for hidden gems (2bp)
- **B4:** saved lot searches scope LOT_HOT alerts per-user (a2l)
- **A1:** env-overridable thresholds for live verification + tuning
- **A1+A4:** lot HOT alerts via auto-OCR sweep (0hj + sep)
- **B1:** Discord webhook for alerts (8cr)

### Fixed
- **ocr:** distinguish vision provider failure from empty results (nl6)
- **B4:** test fixture types so tsc strict-build doesn't fail
- **A1 client:** handle LOT_HOT alerts in NotificationDrawer
- **ocr:** cache-hit replay was silently dropping every cached suggestion (rys)
- **server:** accept note: null in annotation save; surface Zod field in error message (ssw)

## 2026-05-23

### Added
- **client:** wire ⋯ printing picker on SuggestionChip (3z1)
- **client:** PrintingPicker popover component (ey5)
- **server:** name-based supersession in lot revaluation (dgc)
- **ocr:** spend telemetry + per-user daily image cap (Phase 5)
- **ocr:** hint-aware candidate resolution + write-back + test coverage

### Fixed
- **client/build:** explicit npm install --include=dev for Railway
- **build:** use pnpm --force instead of rm node_modules
- **build:** nuke node_modules and reinstall with NODE_ENV=development
- **build:** move typescript to dependencies so tsc is present under NODE_ENV=production
- **build:** pass --prod=false to pnpm install so devDeps are installed
- **build:** move prisma to dependencies so build/start work under NODE_ENV=production
- **dev:** run prisma migrate deploy before starting dev server
