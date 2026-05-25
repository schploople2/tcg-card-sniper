import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e config — drives a real Chromium against the deployed
 * TCG Card Sniper UI. Not wired into CI; intended to be run by hand
 * before shipping a UI-touching change.
 *
 * Default baseURL is prod (https://poke-sniper.up.railway.app). Set
 * PW_BASE_URL=http://localhost:5173 to run against local dev.
 *
 * Auth: see e2e/auth.fixture.ts. Specs that need auth grab the
 * `authed` page from the fixture. Credentials come from PW_USER /
 * PW_PASS env vars — never hardcoded.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // sequential — shared prod backend, easier debugging
  reporter: [["list"]],
  use: {
    baseURL: process.env.PW_BASE_URL ?? "https://poke-sniper.up.railway.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
