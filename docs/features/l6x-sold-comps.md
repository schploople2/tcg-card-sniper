# C1 — True sold-comps (eBay sold listings)

**Bead:** `tcg-card-sniper-dev-l6x` · **Theme:** C (Trustworthy data signals)
**Status:** ✅ shipped
**Migration:** `20260525041435_sold_comp`

## What it does

A new "Sold Comps" tab on the card detail drawer surfaces up to 90 days
of recently-sold eBay listings for the watched card. Shows:

- **Median sold price** (the headline collectors actually trust — eliminates
  the #1 complaint that TCGPlayer "market" is inflated)
- **Count, low, high** range
- **Time since most recent sale**
- Individual sold-listing rows with thumbnail, title, condition,
  total price (sold + shipping), Best Offer flag, and a link out to eBay

Data is cached per (query, ebayItemId) for 24 hours. A user opening the
same drawer twice in a session is one HTTP call; a fresh user gets a
~$0.005 ScrapingBee fetch.

## Data source

eBay actively blocks both free paths to sold-listings data:

| Path | Why it failed |
|---|---|
| Direct scrape of `/sch/i.html?LH_Sold=1` | 403 after ~3 fetches from any datacenter IP. Railway IPs fail immediately. |
| eBay Finding API `findCompletedItems` | Rate limit error 10001 for unapproved apps — effectively unusable. |
| eBay Marketplace Insights API | Requires business approval; out of scope for hobby app. |

**Production path:** ScrapingBee with `render_js=true&premium_proxy=true&country_code=us` (residential proxies + headless render bypasses both bot detection and JS hydration).

**Cost:** 25 credits per fetch on ScrapingBee's free tier (1000 credits/mo → ~40 unique queries/mo). The 24h DB cache keeps that count low in practice.

**Fallback path:** when `SCRAPINGBEE_API_KEY` is absent the service falls
back to the Finding API — which is best-effort and usually fails — so
the UI panel says "No sold comps available yet." That's the cleanest
no-data state.

## User flow

1. Open the card detail drawer (click any watched card).
2. Click the **Sold Comps** tab (next to eBay Listings).
3. See the median + range headline, then individual sold rows.
4. Click ↻ to force-refresh (skip the 24h cache).

## Architecture

```
GET /api/cards/:id/sold-comps
   │
   ├── Build keyword query: <cardName> <cardNumber> <variantKw>
   │
   └── getSoldComps(query, cardId)
          │
          ├── Check DB: any SoldComp rows for this query within 24h?
          │     ├── YES → fromCache: true, return rows
          │     └── NO  → fetchSoldComps(query)
          │                 │
          │                 ├── If SCRAPINGBEE_API_KEY set:
          │                 │     fetchViaScrapingBee → parseSoldListingsHtml
          │                 └── Else (degraded):
          │                       eBay Finding API → mapFindingItem
          │
          └── Return SoldComp rows from last 90d + summary
```

## Schema

```sql
-- 20260525041435_sold_comp/migration.sql
CREATE TABLE "SoldComp" (
  "id"             TEXT NOT NULL,
  "cardId"         TEXT,                 -- nullable: query-keyed scrapes don't need a card link
  "query"          TEXT NOT NULL,        -- exact keyword string used for the scrape
  "ebayItemId"     TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "soldPrice"      DECIMAL(10,2) NOT NULL,
  "shippingCost"   DECIMAL(10,2),
  "totalPrice"     DECIMAL(10,2) NOT NULL,
  "conditionGrade" TEXT,
  "acceptedOffer"  BOOLEAN NOT NULL DEFAULT false,
  "soldAt"         TIMESTAMP(3) NOT NULL,
  "imageUrl"       TEXT,
  "ebayUrl"        TEXT NOT NULL,
  "fetchedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SoldComp_query_ebayItemId_key" ON "SoldComp"("query", "ebayItemId");
CREATE INDEX "SoldComp_cardId_soldAt_idx" ON "SoldComp"("cardId", "soldAt");
CREATE INDEX "SoldComp_query_fetchedAt_idx" ON "SoldComp"("query", "fetchedAt");
```

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/cards/:id/sold-comps` | `{query, summary: {count, median, low, high, mostRecentAt}, rows: SoldComp[], fromCache: bool}` |

## Required Railway env

| Variable | Notes |
|---|---|
| `SCRAPINGBEE_API_KEY` | Sign up free at scrapingbee.com — 1000 credits/mo |

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `SoldComp` model + `Card.soldComps`
- [prisma/migrations/20260525041435_sold_comp/migration.sql](../../prisma/migrations/20260525041435_sold_comp/migration.sql)
- [server/src/services/soldComps.ts](../../server/src/services/soldComps.ts) — `fetchSoldComps`, `parseSoldListingsHtml`, `mapFindingItem`, `getSoldComps`, `summariseSoldComps`
- [server/src/services/__tests__/soldComps.test.ts](../../server/src/services/__tests__/soldComps.test.ts) — 15 tests
- [server/src/routes/cards.ts](../../server/src/routes/cards.ts) — `GET /:id/sold-comps`
- [server/src/config.ts](../../server/src/config.ts) — `SCRAPINGBEE_API_KEY` env
- [client/src/hooks/useSoldComps.ts](../../client/src/hooks/useSoldComps.ts)
- [client/src/components/shared/CardDetailDrawer.tsx](../../client/src/components/shared/CardDetailDrawer.tsx) — new "Sold Comps" tab + `SoldCompsPanel`

## Verification

- [x] 280/280 server tests + 8/8 client tests
- [x] Server + client builds clean
- [x] Migration applied to prod
- [x] ScrapingBee key set on Railway server service
- [x] Live fetch returned 60 parsed listings from real eBay HTML
      (pikachu vmax 188 — prices 2-$370, median calc correct)
- [ ] Hands-on: open a watched card on prod → Sold Comps tab → see real
      data, click a row → opens eBay listing

## Known limitations / follow-up

- **Title cleanup:** eBay's JS-rendered DOM sometimes prepends an 8-digit
  internal tracking ID to titles. Stripped via a regex but YMMV across
  listings.
- **Shipping:** eBay often hides shipping cost behind a "from $X+ shipping"
  banner that our selector misses; rows with shipping=null compute
  totalPrice = soldPrice (conservative).
- **Best Offer accepted flag:** harvested from the text "Best Offer
  accepted" anywhere in the card; eBay's exact wording varies. Some
  accepted-offer sales will be missed.
- **Sold date:** when not surfaced in the markup, defaults to `now()`.
  The 90-day rolling window means stale defaults don't pollute the
  long term, but the per-row "X days ago" can be wrong for some rows.
- **Deal-score waterfall integration:** not wired — sold-comp median
  doesn't yet override TCGPlayer market for deal scoring. Follow-up
  bead worth filing once this has live data baked in for a few days.
- **Cost:** at 25 credits per fetch, the free ScrapingBee tier covers
  ~40 unique queries/mo. The 24h DB cache + per-user usage patterns
  should keep this comfortably within free limits for a single-user app.
