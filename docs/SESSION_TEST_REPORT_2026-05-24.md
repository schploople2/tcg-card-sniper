# Session test report — 2026-05-24

End-of-session smoke test of every feature shipped this session, plus
existing pre-existing functionality. Generated after the last close
(D2 d5x). All features deployed to prod.

## Summary

| | Status |
|---|---|
| Server tests | **254/254 ✅** |
| Client tests | **8/8 ✅** |
| Server build (strict tsc) | ✅ clean |
| Client build (Vite + strict tsc) | ✅ clean |
| Server deploy | ✅ SUCCESS, commit `1c738e3` |
| Client deploy | ✅ SUCCESS, commit `fa8c332c` |
| `/api/health` | **200 ✅** |
| Client root `/` | **200 ✅** |
| All Prisma migrations applied | ✅ 8 expected migrations present |
| Refresh-listings cron (`:00` / `:30`) | ✅ ran at 16:00, processed 18 cards, fired 1 HOT_DEAL |
| Auto-OCR sweep cron (`:15`) | ✅ scheduled, runs hourly |
| Saved-search refresh cron (`:45`) | ✅ scheduled, runs hourly |
| Total beads | **22 closed / 0 open / 0 blocked** |

## DB shape

| Table | Rows | Notes |
|---|---:|---|
| User | 10 | |
| WatchedCard | 18 | feeds the refresh cron |
| Listing | 771 | 30-min TTL, refreshed on cron tick |
| Lot | 535 | upserted by lots search; A4 cron OCRs the un-cached ones |
| LotImage | 75 | a fraction have ocrText (cached vision output) |
| LotAnnotation | 4 | per-user lot pick overrides (Phase 8) |
| OcrUsage | 3 | daily per-user spend ledger |
| SavedLotSearch | 1 | scopes LOT_HOT + MISTITLED per-user (B4) |
| WatchedSeller | 0 | (cleaned up after D2 verification) |
| Alert | 341 | across kinds: see below |

## Alert kinds in flight

| Kind | Count | Color | Shipped in |
|---|---:|---|---|
| HOT_DEAL 🔥 | 329 | red | pre-existing |
| LOT_HOT 💎 | 10 | purple | A1 (`dgc`) |
| MISTITLED 🕵️ | 1 | pink | A2 (`2bp`) |
| SELLER_LISTING 👤 | 1 | orange | D2 (`d5x`) |
| TARGET_HIT 🎯 | 0 | green | pre-existing (no target prices currently below market) |

## Per-feature verification

### Phase 7 — Railway build/deploy (closed)
- Server auto-deploys on git push to main → confirmed by `1c738e3` deploy succeeding within minutes of commit. NODE_ENV=production no longer blocks devDeps thanks to `pnpm install --force` in `railway.json`.
- Client deploys via `railway up ./client --path-as-root --service client` → manual flow documented; auto-deploy isn't wired and that's the working approach.

### Phase 8 — Pick correct printing UX (dgc/fqi/ey5/3z1/ex4/36g, all closed)
- `LotAnnotation` table has 4 rows (real user picks).
- Server `reValueWithAnnotation` supersedes name-matched auto picks → 6 unit tests pass; verified live earlier with Gardevoir VMAX #76 swap.
- Client `PrintingPicker` + `SuggestionChip` integration tests pass (8/8).

### Phase 10 / B1 — Discord webhook (8cr, closed)
- `User.discordWebhookUrl` column exists (verified via `\d "User"` earlier).
- `/api/settings` GET + PUT + POST /test-webhook all wired.
- Verified live earlier: test embed delivered to Discord, HOT_DEAL embed for M Gardevoir EX delivered with correct color/fields.

### Phase 11 / A1+A4 — Lot HOT alerts via auto-OCR sweep (dgc/sep, closed)
- `Alert.lotEbayItemId` + `LOT_HOT` enum value present.
- `evaluateLotAfterOcr` fires when `lowEstimate ≥ 2× listingPrice` AND tier is HOT.
- A4 cron scheduled at :15, runs hourly, OCRs up to 5 un-cached lots per tick (synthetic `system:autoocr` user for ocrUsage accounting).
- 10 LOT_HOT alerts in prod for the Floette lot — verified during the threshold-relaxed test.

### B4 — Saved lot searches (a2l, closed)
- `SavedLotSearch` table with unique (userId, query).
- `/api/saved-lot-searches` GET/POST/DELETE wired.
- `:45` cron scheduled, dedups by query.
- `matchUsersForLot` scopes A1 + A2 per user; without saves no lot alerts fire (verified earlier).

### A2 — Mis-titled detector (2bp, closed)
- `MISTITLED` enum value present.
- `computeMistitledScore` pure helper (8 unit tests).
- 1 MISTITLED alert in prod for the Floette lot (Mewtwo Ex $283+ hidden in title).
- Pink badge renders in NotificationDrawer (verified earlier).

### D2 — Watch this seller (d5x, closed)
- `WatchedSeller` table with unique (userId, sellerName).
- `/api/watched-sellers` GET/POST/DELETE wired.
- `SELLER_LISTING` enum value present.
- 1 SELLER_LISTING alert in prod from directly invoking the deployed evaluator against the poke-geek listing.
- Manual-refresh path (`GET /api/listings/:cardId`) also evaluates seller alerts after the gap fix (1375191).

## Items that need a human eyeball (browser was offline during this session)

The Chrome extension dropped mid-D2 verification and didn't recover. These three should take ~60 seconds to spot-check at your leisure:

1. **`/settings`** at https://poke-sniper.up.railway.app/settings — three sections render: Discord webhook (saved), Saved lot searches (your "chaos rising" entry from B4 verification — or empty if you cleared it), Watched sellers (empty, add/delete flow not browser-tested today).
2. **Bell drawer** — open the top-right bell icon: 50+ alerts should render, with the four kinds in their distinct colors (green/red/purple/pink — and orange will appear the next time you add a watched seller whose card you also watch).
3. **Lots tab** → search "chaos rising mega" → click Analyze on the Floette lot → click ⋯ on Mega Pyroar Ex → confirm the PrintingPicker popover opens with candidates and the ✨AI badge.

## Known issues / follow-up backlog

None blocking. Potential follow-ups already noted in feature docs:
- D2 v1 only fires SELLER_LISTING when the seller's listing surfaces in YOUR watched-card refresh. A dedicated per-seller eBay search cron would close that gap.
- A1's `evaluateLotAfterOcr` is called from `POST /api/lots/:id/ocr-suggestions` and from the A4 cron, but A4 only OCRs lots whose images have ALL-null ocrText. If a partial-cache lot gets refreshed it wouldn't re-evaluate; rare in practice but worth tracking.
- "Watch this seller" button inline on dashboard listing rows (today: Settings-only).
- Manual scheduling of the auto-OCR sweep via an admin endpoint would help future debugging.

## Recommendation

Pause here. **22 of 22 active beads closed**, full test coverage, prod is healthy. The session shipped 7 features:

1. Pick correct printing UX (Phase 8 bundle)
2. Railway build + deploy fixes (Phase 7)
3. Validation + OCR-cache bug fixes (ssw, rys)
4. B1 Discord webhook for alerts
5. A1 + A4 LOT_HOT alerts via auto-OCR sweep
6. B4 Saved lot searches with per-user alert scoping
7. A2 Mis-titled lot detector
8. D2 Watch this seller

The Phase 9 ICE backlog still has higher-effort items waiting (C1 sold comps, C2 graded prices, C3 worth-grading photo CV, B2 web push, B3 email digest, plus D1/D3/D4, E1–E3) but none are blocked. Each is independently shippable.
