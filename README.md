# TCG Card Sniper

A Pokémon card deal-finder. Scores live eBay listings against TCGPlayer / Cardmarket prices, runs Claude Vision on mystery-lot photos to identify hidden value, and pushes alerts to the in-app bell, Discord, and the browser the moment a HOT deal lands.

**Stack:** Express + Prisma + Postgres (server) · React + Vite + TanStack Query (client) · Anthropic Vision for lot OCR · Railway for everything else.

## Features

| Feature | Doc |
|---|---|
| 🎯 Target-price + 🔥 HOT-deal alerts on watched cards (in-app bell) | (core) |
| 📦 Lot detection + AI vision card identification | (Phase 7/8) |
| 🎴 Pick correct printing UX for AI suggestions | (Phase 8) |
| 💬 Per-user Discord webhook fan-out | [8cr](docs/features/8cr-discord-webhook.md) |
| 💎 Lot HOT alerts via auto-OCR sweep | [0hj-sep](docs/features/0hj-sep-lot-hot-alerts.md) |
| 🔍 Saved lot searches (scoped alerts) | [a2l](docs/features/a2l-saved-lot-searches.md) |
| 🕵️ Mis-titled lot detector | [2bp](docs/features/2bp-mistitled-detector.md) |
| 👤 Watched eBay sellers | [d5x](docs/features/d5x-watched-seller.md) |
| 🔔 Web Push notifications (PWA) | [rcs](docs/features/rcs-web-push.md) |
| 💵 Sold-comps panel (eBay completed listings via ScrapingBee) | [l6x](docs/features/l6x-sold-comps.md) |

## Quick start

Requires **Node ≥20**, pnpm, and Postgres.

```bash
git clone <repo>
cd tcg-card-sniper-dev
pnpm install

# Copy and fill in the env vars (see table below)
cp server/.env.example server/.env
cp client/.env.example client/.env  # if present

# Run migrations against your dev DB
pnpm db:migrate

# Start server + client in parallel (server on :3001, client on :5173)
pnpm dev
```

Visit http://localhost:5173 and register an account.

## Environment variables

### Server

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | ≥32 chars; signs auth tokens |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | yes | eBay Browse API OAuth |
| `EBAY_ENVIRONMENT` | no | `sandbox` (default) or `production` |
| `EBAY_DELETION_VERIFICATION_TOKEN` | yes for prod | Marketplace Account Deletion webhook |
| `EBAY_DELETION_ENDPOINT_URL` | yes for prod | Same |
| `CORS_ORIGIN` | no | Defaults to local dev client URL |
| `OCR_PROVIDER` | no | `claude` or `none` (default) |
| `ANTHROPIC_API_KEY` | required when OCR enabled | Claude Vision for lot OCR |
| `OCR_MAX_IMAGES_PER_LOT` | no | Default 6 |
| `OCR_DAILY_IMAGES_PER_USER` | no | Default 100 |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | required for push to work | Generate with `node -e "console.log(require('web-push').generateVAPIDKeys())"` |
| `VAPID_SUBJECT` | no | `mailto:` contact for browser prompts |
| `SCRAPINGBEE_API_KEY` | required for sold comps | Free tier at scrapingbee.com (1000 credits/mo) |

### Client

| Var | Required | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | yes | Server URL (e.g. `http://localhost:3001` for dev) |

## Architecture

In one paragraph: a Vite SPA talks to an Express/Prisma API which holds all the data and runs every cron job. Cron jobs refresh listings every 30 min, OCR un-cached high-value lots hourly, re-run saved searches hourly, and snapshot prices daily. New alerts fan out to three independent channels: the in-app bell, Discord webhooks (per-user URL), and Web Push (per-device subscriptions). External calls go to eBay (Browse + Finding), Anthropic Vision, ScrapingBee (sold-comp proxy), and the pokemontcg.io catalog.

Full map in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Testing

```bash
pnpm --filter server test              # ~290 vitest tests, mocked Prisma + axios + Anthropic
pnpm --filter client test              # ~34 vitest + RTL component tests
pnpm --filter client test:e2e          # Playwright, needs PW_USER/PW_PASS
```

Three layers documented in **[docs/TESTING.md](docs/TESTING.md)**. Per-package details in [client/e2e/README.md](client/e2e/README.md).

## Deployment

Railway, two services (`server` auto-deploys from main; `client` is manual). Full runbook + recurring gotchas in **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — read this before your first deploy. Notable traps: Node 20 is mandatory (cheerio→undici), and every new Prisma migration tries to drop two manually-created trigram indexes that need to be stripped out by hand.

## Project layout

```
.
├── server/        Express + Prisma. Routes, services, jobs, tests.
│   └── src/
│       ├── routes/      JSON API endpoints
│       ├── services/    Business logic, eBay client, scoring, OCR, push, etc.
│       ├── jobs/        Cron workers (refreshListings, autoOcrLots, ...)
│       └── middleware/  Auth, error handling
├── client/        React + Vite SPA.
│   ├── src/
│   │   ├── pages/         Top-level routes (Dashboard, Settings, Login)
│   │   ├── components/    Shared UI (drawers, modals, picker)
│   │   ├── hooks/         React-query wrappers (useListings, useSoldComps, ...)
│   │   └── lib/           api client, util helpers
│   ├── public/    PWA manifest, service worker (sw.js)
│   └── e2e/       Playwright specs
├── prisma/        schema.prisma + migrations
├── docs/          ARCHITECTURE, DEPLOYMENT, TESTING, features/
├── .beads/        Beads issue tracker state
├── CLAUDE.md      Agent-facing pointers
└── README.md      You are here
```

## Issue tracking

Issues live in [beads](https://github.com/gastownhall/beads) — a local-first Dolt-backed tracker. Run `bd ready` to see what's actionable, `bd show <id>` for details. The issues file syncs via `refs/dolt/data` on the git remote, so a `git pull` brings new tickets along. Convention: every feature bead gets a `docs/features/<id>-*.md` doc plus a hands-on test before `bd close`.

## Contributing

This is a single-developer hobby project — no formal contribution flow. If you're forking it, read CLAUDE.md and docs/ first, then poke around. The code under `server/src/services/` and `client/src/components/shared/` is where most of the interesting logic lives.
