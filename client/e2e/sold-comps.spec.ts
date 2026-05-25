import { test, expect } from "./auth.fixture";

/**
 * C1 (l6x) — Sold Comps tab e2e.
 *
 * Opens the first watched card on the dashboard, clicks the Sold Comps
 * tab, and asserts one of the two valid terminal states renders:
 *   - the summary headline ("Median sold (last 90d)") for a card with comps
 *   - the empty state ("No sold comps in the last 90 days") for an
 *     obscure card with no scrape results
 *
 * Either is a passing test — what we're catching is regressions where
 * neither renders (e.g. the panel crashed, the tab wiring broke, the
 * 90d window query throws).
 *
 * Pre-req: the PW_USER account must have at least one watched card.
 */
test("Card drawer → Sold Comps tab loads without error", async ({
  authedPage,
}) => {
  await authedPage.goto("/");

  // Click into the first watched-card row. The dashboard renders these
  // as buttons with the card name as the accessible label.
  const firstCardRow = authedPage
    .getByRole("button", { name: /.+/ })
    .filter({ hasNot: authedPage.getByRole("img") })
    .first();
  // Fallback: just look for any data-testid="watched-card" if present.
  const watchedCard = authedPage.getByTestId("watched-card-row").first();
  const target = (await watchedCard.count()) > 0 ? watchedCard : firstCardRow;
  await target.click();

  // Drawer opens — wait for the tab list to appear.
  await expect(
    authedPage.getByRole("tab", { name: /Sold Comps/i })
  ).toBeVisible({ timeout: 10_000 });

  await authedPage.getByRole("tab", { name: /Sold Comps/i }).click();

  const headline = authedPage.getByText(/Median sold/i);
  const empty = authedPage.getByText(/No sold comps in the last 90 days/i);
  await expect(headline.or(empty)).toBeVisible({ timeout: 30_000 });
});
