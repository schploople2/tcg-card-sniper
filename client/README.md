# client

React + Vite single-page app for TCG Card Sniper. Talks to the [server](../server/README.md) over JSON; renders the watchlist, deal feed, lot analyzer, alerts bell, Settings, and the card detail drawer (including the C1 Sold Comps tab and the nl6 AI-down UX).

## Dev loop

```bash
pnpm install                                # from repo root
pnpm --filter client dev                    # vite, port 5173
pnpm --filter client test                   # vitest + RTL, ~34 tests
pnpm --filter client build                  # tsc + vite build → dist/
pnpm --filter client test:e2e               # Playwright (see e2e/README.md)
```

## Layout

```
src/
├── main.tsx              React entry + react-query provider + router
├── pages/                Dashboard, Watchlist, Settings, Login
├── components/
│   ├── layout/           PageShell, Navbar, BellButton
│   ├── shared/           Drawers/modals/chips (LotAnalyzerModal,
│   │                     CardDetailDrawer, SoldCompsPanel,
│   │                     SuggestionsPanel, PrintingPicker, ...)
│   ├── ui/               Radix + shadcn primitives
│   └── shared/__tests__/ Vitest + RTL component tests
├── hooks/                React-query wrappers (useListings, useSoldComps,
│                         usePushSubscription, ...)
├── lib/                  axios api client, util helpers
└── types/                Shared TS types mirroring server response shapes
public/
├── manifest.webmanifest  PWA manifest
└── sw.js                 Service worker (web push)
e2e/                      Playwright specs (see e2e/README.md)
```

## Env vars

Build-time only:

| Var | Required | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | yes | Server URL — e.g. `http://localhost:3001` for dev |

Put in `client/.env` for local dev.

## Tests

Two layers:

- **Component (`pnpm --filter client test`)** — Vitest + RTL + jsdom. Hooks are mocked at the import boundary. New tests go under `src/components/shared/__tests__/`.
- **e2e (`pnpm --filter client test:e2e`)** — Playwright against the deployed app. Setup + per-spec details in [e2e/README.md](e2e/README.md).

Full guide: [../docs/TESTING.md](../docs/TESTING.md).
