import { test as base, type Page } from "@playwright/test";

/**
 * Auth fixture — logs in once per spec via the JSON API and stashes the
 * JWT in localStorage so subsequent navigations carry it automatically.
 *
 * Why not click through the login form on every spec: it's slow, noisy,
 * and brittle to copy changes on the login page. POSTing /api/auth/login
 * directly mirrors what the client does internally (see Login.tsx) but
 * skips the UI round-trip.
 *
 * Required env:
 *   PW_USER — email of an existing user on the target environment
 *   PW_PASS — password for that user
 *
 * If either is missing the fixture throws at setup so specs fail loudly
 * with a useful message rather than silently 401'ing inside the app.
 */

interface AuthedFixtures {
  authedPage: Page;
}

export const test = base.extend<AuthedFixtures>({
  authedPage: async ({ page, baseURL }, use) => {
    const user = process.env.PW_USER;
    const pass = process.env.PW_PASS;
    if (!user || !pass) {
      throw new Error(
        "PW_USER and PW_PASS must be set in the environment to run auth-required specs."
      );
    }
    if (!baseURL) {
      throw new Error("baseURL is not configured");
    }

    // Hit the JSON API directly to get a JWT. Mirrors what client/src/pages/Login.tsx does.
    const apiBase = baseURL.replace(/\/$/, "");
    const resp = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: user, password: pass }),
    });
    if (!resp.ok) {
      throw new Error(`Auth fixture login failed: ${resp.status}`);
    }
    const data = (await resp.json()) as { token?: string };
    if (!data.token) {
      throw new Error("Auth fixture login: no token in response");
    }

    // Seed localStorage with the token BEFORE the SPA boots, so the auth
    // header is set on the first request.
    await page.addInitScript((token) => {
      window.localStorage.setItem("token", token);
    }, data.token);

    await use(page);
  },
});

export { expect } from "@playwright/test";
