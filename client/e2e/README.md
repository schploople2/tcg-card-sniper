# Playwright e2e

Real-browser smoke tests for the TCG Card Sniper UI. **Not in CI** —
these hit a live environment (prod by default), so they're run by hand
before shipping a UI-touching change.

## Setup (once per machine)

```bash
cd client
pnpm install
pnpm exec playwright install chromium
```

## Required env

| Var | Purpose |
|---|---|
| `PW_USER` | Email of an account on the target environment |
| `PW_PASS` | That account's password |
| `PW_BASE_URL` | Optional. Defaults to `https://poke-sniper.up.railway.app`. Set to `http://localhost:5173` to run against local dev. |

## Run

```bash
# All specs, prod
PW_USER=you@example.com PW_PASS=... pnpm --filter client test:e2e

# Single spec, headed
PW_USER=... PW_PASS=... pnpm --filter client test:e2e push-notifications --headed

# Local dev
PW_BASE_URL=http://localhost:5173 PW_USER=... PW_PASS=... pnpm --filter client test:e2e
```

## Specs

| Spec | Covers |
|---|---|
| `push-notifications.spec.ts` | B2 — Settings → Push section, Enable → Subscribed transition with pre-granted notifications permission |
| `sold-comps.spec.ts` | C1 — Card drawer → Sold Comps tab renders headline OR empty state (whichever; passes either way) |
| `vision-failure.spec.ts` | nl6 — intercepts the OCR call with a synthetic 503/all-failed and asserts the AI-down banner + Retry render |

## Adding a new spec

1. Drop a new `*.spec.ts` in this directory.
2. Use the `test` + `expect` exports from `./auth.fixture` if you need auth (they return an already-logged-in `authedPage`).
3. Prefer `getByRole` / `getByTestId` over CSS selectors — survives class renames.
4. If the spec needs to mock the server, use `page.route(...)` (see `vision-failure.spec.ts` for the pattern).

## Why not in CI?

These hit a real production environment with a real account. Running on
every PR would burn API credits (ScrapingBee, Anthropic) and risk
polluting prod state with test data. They're a deliberate
ship-readiness gate, not a regression alarm.
