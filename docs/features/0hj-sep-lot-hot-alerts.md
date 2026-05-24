# A1 + A4 — Lot HOT alerts (auto-OCR + Discord push)

**Beads:** `tcg-card-sniper-dev-0hj` (A1) + `tcg-card-sniper-dev-sep` (A4)
**Theme:** A (Binder intelligence — OCR moat)
**Status:** in progress (pending live verification)
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
- [ ] **Hands-on: user-triggered path** — open a lot whose lowEstimate / asking ratio ≥ 2 (e.g. Mew VMAX 269/264 — lowEstimate $17.55, asking $460, ratio 0.04 → won't fire; need to find / contrive a qualifying lot OR temporarily lower the threshold for testing) ⟵ blocks close
- [ ] **Hands-on: auto-OCR path** — verify a never-OCR'd Lot row exists in the DB; wait for next :15 sweep (or trigger manually via a temp endpoint); confirm log lines show "[autoOcrLots]" + "[lotAlerts]" + Discord embed lands ⟵ blocks close

## Future improvements (out of scope, follow-up beads)

- B4 (saved searches) provides per-user scoping so users can opt into specific lot types only
- A2 (mis-titled detector) reuses the same auto-OCR pipeline with a different threshold rule
- A3 (rarity bucketing) extends the embed with rarity summary fields
- Tunable threshold via env vars or per-user setting
- Auto-sweep budget enforcement via global spend ceiling, not just per-user
- Backfill: one-shot script to OCR every existing un-OCR'd lot before turning the cron loose
