import { test, expect } from "./auth.fixture";

/**
 * B2 (rcs) — Push notifications Settings panel e2e.
 *
 * Pre-grants the notifications permission so the SPA can subscribe
 * without the (unautomatable) native browser prompt, then asserts the
 * Settings page renders the section and the Enable → Subscribed
 * transition fires.
 *
 * Run: PW_USER=... PW_PASS=... pnpm --filter client test:e2e push-notifications
 */
test("Settings → Push notifications: subscribe flow renders + transitions", async ({
  authedPage,
  context,
  baseURL,
}) => {
  await context.grantPermissions(["notifications"], { origin: baseURL });

  await authedPage.goto("/settings");
  await expect(
    authedPage.getByRole("heading", { name: /Push notifications/i })
  ).toBeVisible();

  // The hook probes browser support + existing subscription on mount, so
  // the initial state may be `default` (no sub yet) or `subscribed`
  // (sub already exists from a previous run on this profile). Either is
  // valid — we just want to see one of the two terminal states render.
  const subscribed = authedPage.getByText(/Subscribed on this device/i);
  const enableBtn = authedPage.getByRole("button", {
    name: /Enable push notifications/i,
  });

  if (await subscribed.isVisible().catch(() => false)) {
    // Already subscribed from a prior run — disable so the next run can
    // re-exercise the enable flow.
    const disable = authedPage.getByRole("button", { name: /^Disable$/i });
    await disable.click();
    await expect(enableBtn).toBeVisible();
  }

  await expect(enableBtn).toBeEnabled();
  await enableBtn.click();
  await expect(subscribed).toBeVisible({ timeout: 10_000 });
});
