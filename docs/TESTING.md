# Testing

Three test layers, each answering a different question. All run locally; only the first two are appropriate for CI.

## Layer 1 — Server tests (Vitest)

**What they cover:** pure functions, route handlers, service-layer logic, alert pipeline branches. Prisma + axios + the Anthropic SDK + web-push are mocked at the module boundary.

```bash
pnpm --filter server test           # one-shot
pnpm --filter server test --watch   # rerun on save
```

**Pattern** — `vi.hoisted` + `vi.mock` so the mocks are set up before the module under test imports them:

```ts
const { findMany, createMany } = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock("../../db.js", () => ({
  prisma: { listing: { findMany }, alert: { createMany } },
}));

let evaluateListings: typeof import("../alerts.js").evaluateListings;
beforeAll(async () => {
  ({ evaluateListings } = await import("../alerts.js"));
});
```

Files live alongside the code they test: `server/src/services/__tests__/*.test.ts`. See [`alerts.test.ts`](../server/src/services/__tests__/alerts.test.ts) and [`soldComps.test.ts`](../server/src/services/__tests__/soldComps.test.ts) for the established patterns.

## Layer 2 — Client component tests (Vitest + React Testing Library)

**What they cover:** how a component renders for each combination of props / hook state. Hooks are mocked at the import boundary (`vi.mock('@/hooks/useX', ...)`).

```bash
pnpm --filter client test
pnpm --filter client test --watch
```

**Pattern** — mock the hook, drive each state, assert with `screen.getByRole` / `getByTestId`:

```tsx
const { useMock, subscribe } = vi.hoisted(() => ({
  useMock: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/hooks/usePushSubscription", () => ({
  usePushSubscription: useMock,
}));

beforeEach(() => useMock.mockReturnValue({ status: "default", busy: false, subscribe }));

it("fires subscribe on click", () => {
  render(<PushSection />);
  fireEvent.click(screen.getByRole("button", { name: /enable push/i }));
  expect(subscribe).toHaveBeenCalledOnce();
});
```

Files: `client/src/components/shared/__tests__/*.test.tsx`. The seed examples are [`PushSection.test.tsx`](../client/src/components/shared/__tests__/PushSection.test.tsx), [`SoldCompsPanel.test.tsx`](../client/src/components/shared/__tests__/SoldCompsPanel.test.tsx), [`SuggestionsPanel.test.tsx`](../client/src/components/shared/__tests__/SuggestionsPanel.test.tsx).

**One pre-req:** the component must be importable in isolation. If a component is non-default-exported and only used inside one parent file, `export` it (or extract it to its own file) — that's a one-line tax for testability.

## Layer 3 — Client e2e (Playwright)

**What they cover:** the full user flow against a real Chromium driving the deployed app. Catches regressions that only show up when the SPA + server + database actually talk to each other.

```bash
PW_USER=you@example.com PW_PASS=... pnpm --filter client test:e2e
PW_USER=... PW_PASS=... pnpm --filter client test:e2e push-notifications --headed
PW_BASE_URL=http://localhost:5173 PW_USER=... PW_PASS=... pnpm --filter client test:e2e
```

See [`client/e2e/README.md`](../client/e2e/README.md) for the full guide, env vars, and per-spec coverage. Notable patterns:

- Auth is grabbed via `POST /api/auth/login` in the [`auth.fixture.ts`](../client/e2e/auth.fixture.ts) and stashed in `localStorage` via `addInitScript` — no clicking through the login UI on every spec
- Network mocking via `page.route(...)` lets specs assert error-state UX without actually breaking the backend (see [`vision-failure.spec.ts`](../client/e2e/vision-failure.spec.ts))
- Browser permissions like push notifications can be pre-granted via `context.grantPermissions(['notifications'])`

**Not in CI.** These hit live external services (eBay, Anthropic, ScrapingBee) using a real account, so they're a ship-readiness gate run by hand, not a per-PR alarm.

## Manual verification (Chrome MCP / Playwright MCP)

For ad-hoc visual checks during development — "did the picker popover open in the right place?", "does the new badge color look right?" — drive a real browser with the Chrome MCP. Faster than writing an automated spec for a one-time question.

When to use it: feature shipping verification, debugging a visual bug, exploring a flow you haven't seen yet.

When **not** to use it: catching regressions on already-shipped features — that's what Layer 3 is for.

## The convention

> **Every new feature bead requires a `docs/features/<id>-*.md` doc AND a hands-on test before `bd close`.**

Hands-on test = at least one of: real eBay click-through, deployed-endpoint curl, or a Playwright spec that covers the new flow. A bead is not "done" until you've watched the thing work against real prod data.
