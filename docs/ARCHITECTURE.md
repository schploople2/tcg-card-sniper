# Architecture

A high-level system map of TCG Card Sniper. For per-feature deep dives see [docs/features/](features/).

## Services

| Service | What it is | Where it runs |
|---|---|---|
| **client** | React/Vite single-page app, served as static assets via Caddy/serve | Railway `client` service |
| **server** | Express + Prisma JSON API, hosts all background cron jobs | Railway `server` service |
| **Postgres** | Primary store: users, watched cards, listings, alerts, lots, OCR cache, push subs, sold comps | Railway managed Postgres |
| **eBay Browse API** (OAuth) | Live listing search powering the deal feed | external |
| **eBay Finding API** | Legacy fallback for sold-comps (rate-limited; usually unusable) | external |
| **Anthropic Vision** | Lot OCR — identifies cards visible in eBay listing photos | external |
| **Discord webhooks** | Per-user alert fan-out destination | external |
| **Web Push (VAPID)** | Browser/PWA push notifications, one row per device subscription | external (FCM/Mozilla/Apple push services) |
| **ScrapingBee** | Residential proxy + headless render for sold-listings scraping (eBay blocks datacenter IPs) | external |

## Data model

Full shapes in [`prisma/schema.prisma`](../prisma/schema.prisma). Grouped by purpose:

| Domain | Models |
|---|---|
| **Auth** | `User` |
| **Catalog** | `Card`, `PriceCache`, `PriceSnapshot` — synced weekly from pokemontcg.io |
| **Watching** | `WatchedCard`, `WatchedSeller`, `SavedLotSearch` — per-user subscriptions |
| **Listings** | `Listing`, `Alert` — live eBay listings + the alerts they trigger |
| **Lots** | `Lot`, `LotImage`, `LotAnnotation`, `OcrUsage` — mystery-lot analysis pipeline |
| **Comps** | `SoldComp` — scraped sold listings, keyed by `(query, ebayItemId)` |
| **Delivery** | `PushSubscription` — per-device web push endpoints |

`AlertKind` enum: `TARGET_HIT` · `HOT_DEAL` · `LOT_HOT` · `MISTITLED` · `SELLER_LISTING`.

## Background jobs

All node-cron, defined under [`server/src/jobs/`](../server/src/jobs/), kicked off from [`server/src/index.ts`](../server/src/index.ts):

| Cron | Schedule | What it does |
|---|---|---|
| `refreshListings` | `0 0,30 * * * *` | For each watched card: pull fresh eBay listings, score them, upsert `Listing` rows, fire alerts |
| `snapshotPrices` | `0 5 0 * * *` | Daily UTC midnight — write a `PriceSnapshot` per watched card for history charts |
| `syncCatalog` | weekly | Refresh the local `Card` catalog from pokemontcg.io |
| `autoOcrLots` | `0 15 * * * *` | Hourly — OCR up to 5 high-value un-cached lots and fire LOT_HOT / MISTITLED alerts |
| `refreshSavedSearches` | `0 45 * * * *` | Hourly — re-run each user's `SavedLotSearch` queries, feed results to the lot pipeline |

## Alert pipeline

```
Listing or Lot enters the system
      │
      ▼
evaluateListings / evaluateLotAfterOcr / evaluateLotForMistitling / evaluateListingsForWatchedSellers
      │
      ▼ (dedup via Alert unique index)
prisma.alert.createMany
      │
      ├─ in-app bell (alerts route → NotificationDrawer)
      ├─ Discord embed (per-user webhookUrl, optional)
      └─ Web Push (one notification per PushSubscription row, optional)
```

Each fan-out path is independent and fire-and-forget. A missing webhook / no push subs / no listener never blocks the others — and never blocks the user-facing request that triggered the alert.

## Deal-score waterfall

The `marketPrice` for a listing is resolved by [`server/src/services/priceVariant.ts:resolveMarketPrice`](../server/src/services/priceVariant.ts) in this order:

1. **TCGPlayer** (pokemontcg.io variant prices) — gold standard for US Pokémon
2. **TCGPlayer scrape** — feature-flagged, currently disabled (TCGPlayer is client-rendered)
3. **Cardmarket** (EUR) — fallback for alt-arts and JP exclusives that have no TCGPlayer data
4. **none** — listings still surface as UNSCORED so the user can browse, no deal tier assigned

**Future:** sold-comp median ([feat C1](features/l6x-sold-comps.md)) is collected but not yet wired into the waterfall. The plan is to insert it ahead of TCGPlayer when `count >= N` because true-sold prices are more trustworthy than "asking" market.

Deal tiers (in [`server/src/services/dealScore.ts`](../server/src/services/dealScore.ts)):
- **HOT** — total cost ≥25% below adjusted market
- **GOOD** — 10–25% below
- **FAIR** — 0–10% below
- **OVER** — at or above market
- **UNSCORED** — no marketPrice available

## External rate limits we care about

- **eBay Browse API** — generous, no practical limit at our volume
- **eBay Finding API `findCompletedItems`** — rate-limited to near-zero for unapproved apps. We treat as best-effort only
- **Anthropic Vision** — pay-per-token, ~$0.003/image; per-user soft cap via `OCR_DAILY_IMAGES_PER_USER` (default 100/day)
- **ScrapingBee** — 1000 credits/mo on the free tier; sold-comp scrape costs 25 credits each (premium + JS render). 24h DB cache per query keeps this low.
- **pokemontcg.io** — generous; weekly catalog sync only

## Repo layout (top level)

```
.
├── server/        Express + Prisma. Routes, services, jobs, tests.
├── client/        React + Vite SPA. Pages, components, hooks, e2e/.
├── prisma/        schema.prisma + migrations
├── docs/          ARCHITECTURE / DEPLOYMENT / TESTING + features/
├── .beads/        Beads issue tracker state (JSONL export + Dolt config)
├── CLAUDE.md      Agent-facing pointers (project-wide)
└── README.md      Human-facing entry point
```
