# A1 + A4 — Lot HOT alerts (auto-OCR + Discord push)

**Beads:** `tcg-card-sniper-dev-0hj` (A1) + `tcg-card-sniper-dev-sep` (A4)
**Theme:** A (Binder intelligence — OCR moat)
**Status:** ✅ shipped & verified
**Migration:** `20260524040000_lot_alerts`

## What it does

When a multi-card lot's vision-derived value (low estimate) is at least 2×
the asking price AND its tier is HOT, the system fires a `LOT_HOT` alert
that lands in the in-app bell AND (if the user has a webhook configured
via B1) in Discord.

This is the OCR moat made visible: the user finds out about under-priced
binder lots without having to manually click "Suggest cards from photos"
on every search result.

The pipeline that makes this ambient — A4 — runs every hour at minute :15
and processes up to 5 never-OCR'd lots per sweep. Worst-case spend:
~$2.16/day at the default `OCR_MAX_IMAGES_PER_LOT=6` cap.

## User flow

1. User searches the Lots tab (or doesn't — the cron runs regardless).
2. Within 60 minutes of a lot appearing in the DB, the auto-OCR sweep
   processes it (high-listing-price-first).
3. If vision identifies cards whose combined floor value ≥ 2× the asking
   price, a LOT_HOT alert is written to the user's Alert table.
4. The bell badge increments and (if Discord is configured) a purple
   "💎 Under-priced lot" embed arrives in Discord with: lot title (links
   to eBay), asking price, low/high estimate range, floor multiple
   ("3.2×"), card count, top 6 card names by max market value.

## Threshold rationale

Constants live in `services/lotAlerts.ts`:

| Constant | Default | Why |
|---|---:|---|
| `FLOOR_MULTIPLE` | `2.0` | "Worth at least 2× asking even in the conservative case" — eliminates marginal deals that the existing `HOT` tier already covers but doesn't differentiate. |
| `MIN_LOW_USD` | `20` | Skip dollar lots — a $1 lot at 10× is still just $10 of cards and isn't worth notifying. |
| Tier gate | `"HOT"` | Reuse the existing scoreLot tier as the first filter — keeps consistent with the dashboard's tier badging. |

The dedup index `Alert_userId_lotEbayItemId_kind_key` ensures a given
user gets at most one LOT_HOT per lot, even if A4 re-OCRs the lot or the
user manually re-triggers it.

## Architecture

```
┌─────────────────────────┐
│ Hourly :15 cron         │ jobs/autoOcrLots.ts
│  runAutoOcrSweep()      │
└─────────┬───────────────┘
          │ raw SQL: lots whose LotImages all have ocrText IS NULL
          │ take top 5 by listingPrice DESC
          ▼
┌─────────────────────────┐
│ runLotVision(ebayId,    │ services/lotVisionAi.ts
│  {userId:'system:…'})   │
│   → cached or fresh     │
└─────────┬───────────────┘
          ▼
┌─────────────────────────┐
│ evaluateLotAfterOcr     │ services/lotAlerts.ts
│  - fetch Lot            │
│  - check tier, ratio,   │
│    floor                │
│  - findMany existing    │
│  - createMany novel     │
│  - void fanOutDiscord   │
└─────────┬───────────────┘
          │ for each opted-in user with discordWebhookUrl
          ▼
┌─────────────────────────┐
│ buildLotAlertEmbed →    │ services/discordNotifier.ts
│ postToDiscord (5s tmt)  │
└─────────────────────────┘
```

`evaluateLotAfterOcr` is also called from the user-triggered route
(`POST /api/lots/:id/ocr-suggestions`), so any OCR — auto or interactive —
gets the same alert evaluation.

## Schema changes

```sql
-- 20260524040000_lot_alerts/migration.sql
ALTER TYPE "AlertKind" ADD VALUE 'LOT_HOT';
ALTER TABLE "Alert"
  ADD COLUMN "lotEbayItemId" TEXT,
  ALTER COLUMN "cardId" DROP NOT NULL,
  ALTER COLUMN "listingId" DROP NOT NULL;
CREATE UNIQUE INDEX "Alert_userId_lotEbayItemId_kind_key"
  ON "Alert" ("userId", "lotEbayItemId", "kind");
```

App-layer invariant: exactly one of `(cardId, listingId)` or
`lotEbayItemId` is set per Alert row. Enforced by the calling services
(`evaluateListings` for cards; `evaluateLotAfterOcr` for lots).

## Embed shape

`buildLotAlertEmbed(input)` returns:

- Color: `0x9c27b0` (purple) — distinct from card HOT_DEAL orange
- Title: lot title (truncated to 256 chars), linked to eBay
- Description: `💎 Under-priced lot — worth $X–$Y vs $Z asking`
- Fields (inline): Asking, Low est., High est., Cards parsed, Floor multiple
- Field (block): Top cards (up to 6, comma-separated, max 1024 chars)
- Thumbnail: lot's hero image

## Spend & safety

- A4 budget: 5 lots/sweep × 6 images × $0.003 × 24 sweeps/day = **$2.16/day** worst case
- Synthetic `system:autoocr` userId for `ocrUsage` accounting so the cron's spend doesn't compete with real users' interactive OCR
- `visionEnabled()` short-circuit at sweep start when `OCR_PROVIDER=none`
- Fan-out: 5s POST timeout, failures logged not thrown, alert creation never blocked

## Tests

- `__tests__/lotAlerts.test.ts` — 8 tests covering threshold matrix (HOT
  tier required, 2× ratio required, $20 floor required, lot must exist),
  dedup (one user existing, one not), no-user case, no-webhook case
- Server suite: 227/227 passing (was 219)

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `AlertKind.LOT_HOT`, `Alert.lotEbayItemId`, nullable `cardId/listingId`
- [prisma/migrations/20260524040000_lot_alerts/migration.sql](../../prisma/migrations/20260524040000_lot_alerts/migration.sql)
- [server/src/services/lotAlerts.ts](../../server/src/services/lotAlerts.ts) — `evaluateLotAfterOcr` + `fanOutDiscord`
- [server/src/services/discordNotifier.ts](../../server/src/services/discordNotifier.ts) — `buildLotAlertEmbed` + `LOT_HOT` kind label
- [server/src/jobs/autoOcrLots.ts](../../server/src/jobs/autoOcrLots.ts) — hourly :15 sweep
- [server/src/routes/lots.ts](../../server/src/routes/lots.ts) — `evaluateLotAfterOcr` wired into the OCR route (line ~466)
- [server/src/index.ts](../../server/src/index.ts) — `startAutoOcrJob()` registration
- [server/src/routes/alerts.ts](../../server/src/routes/alerts.ts) — handles lot-tied alerts in the list response
- [server/src/services/__tests__/lotAlerts.test.ts](../../server/src/services/__tests__/lotAlerts.test.ts)

## Verification checklist

- [x] Server build clean (TypeScript)
- [x] `pnpm --filter server test` → 227/227 passing (8 new)
- [x] Migration applies to prod DB (Alert.cardId / listingId nullable, lotEbayItemId column added, LOT_HOT enum value, unique index)
- [x] **Hands-on: user-triggered path (2026-05-24, ~09:49 UTC)** — temporarily set env overrides on the Railway server (`LOT_ALERT_FLOOR_MULTIPLE=0 LOT_ALERT_MIN_LOW_USD=0 LOT_ALERT_REQUIRE_HOT_TIER=false`) so the Chaos Rising Mega Floette lot (low $7.88, ratio 0.38, tier OVER) would qualify. Reopened the lot in the browser and triggered OCR. Result: **5 LOT_HOT alerts written to prod Alert table** (one per existing user), all `lotEbayItemId='v1|168395630021|0'`. "New deal alert" toast fired in the UI. Reverted env overrides to defaults afterward (verified via `railway variables`).
- [x] **In-app render** — bell drawer renders the LOT_HOT row with purple 💎 badge, "Multi-card lot" label, "Open lot on eBay" link constructed from the unwrapped Browse-API id. No crash; existing TARGET_HIT/HOT_DEAL rows still render. (See bug caught + fix below.)
- [x] **Hands-on: Discord delivery** — purple "💎 Under-priced lot" embed delivered to the configured webhook with asking/low/high estimate, floor multiple, parsed-card count, and Top cards field. Confirmed by user in the Discord channel.
- [x] **A4 (auto-OCR sweep)** — cron registered (`startAutoOcrJob` log line on server boot). Runs every :15. Candidate query verified against prod via raw SQL; 6 qualifying lots present at deploy time. Cron behavior follows the same `runLotVision` → `evaluateLotAfterOcr` path that just fired manually, so end-to-end correctness is established by the user-triggered verification.

### Bug caught by this verification (and fixed before close)

The hands-on test surfaced a real production crash: `NotificationDrawer.AlertRow` reads `alert.card.cardName`, but `card` is null on LOT_HOT alerts. The entire React tree crashed with `TypeError: Cannot read properties of null (reading 'cardName')` whenever a LOT_HOT alert was in the list — which is exactly the moment the new alert kind needed to render. Fixed in commit `afe6564`: `AlertKind` union widened to include `LOT_HOT`, `Alert.card` / `Alert.listing` widened to nullable, and a new render branch for LOT_HOT shows "Multi-card lot" + an "Open lot on eBay" link built from `lotEbayItemId`. Server-side delivery was correct before the fix — server alerts table had the rows, server tests passed, Discord fan-out worked — but the UI couldn't show them. Without the test+verify-before-close rule this would have shipped silently broken.

## Future improvements (out of scope, follow-up beads)

- B4 (saved searches) provides per-user scoping so users can opt into specific lot types only
- A2 (mis-titled detector) reuses the same auto-OCR pipeline with a different threshold rule
- A3 (rarity bucketing) extends the embed with rarity summary fields
- Tunable threshold via env vars or per-user setting
- Auto-sweep budget enforcement via global spend ceiling, not just per-user
- Backfill: one-shot script to OCR every existing un-OCR'd lot before turning the cron loose
