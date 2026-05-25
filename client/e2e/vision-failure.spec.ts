import { test, expect } from "./auth.fixture";

/**
 * nl6 — AI vision-down UX e2e.
 *
 * Intercepts POST /api/lots/:id/ocr-suggestions before any real call
 * fires and returns a synthetic 503 with providerStatus=all-failed —
 * the exact response shape the server emits when every Anthropic image
 * call fails (credit exhausted, upstream 5xx, etc).
 *
 * Asserts:
 *   - The amber "AI vision is temporarily unavailable" banner renders
 *   - A Retry button is offered
 *   - The original "Suggest cards from photos" trigger is gone
 *
 * Pre-req: the PW_USER account must be able to navigate to a lot — uses
 * the Lots tab search to find any lot with images.
 */
test("Lot analyzer → all-failed vision shows AI-down banner + Retry", async ({
  authedPage,
}) => {
  // Mock every ocr-suggestions POST with a 503/all-failed response BEFORE
  // we navigate, so the first user-triggered call hits the mock.
  await authedPage.route("**/api/lots/*/ocr-suggestions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "AI vision is temporarily unavailable. Please try again later.",
          providerStatus: "all-failed",
          imagesFailed: 6,
        }),
      });
    } else {
      await route.continue();
    }
  });

  await authedPage.goto("/");

  // Switch to the Lots tab and pull up any lot result. The exact tab
  // labels live in pages/Dashboard.tsx — adjust if those change.
  await authedPage.getByRole("tab", { name: /Lots/i }).click();
  const search = authedPage.getByPlaceholder(/search lots/i);
  await search.fill("pokemon mystery lot");
  await search.press("Enter");

  // Open the first analyzer — eyeball Analyze buttons.
  const analyze = authedPage.getByRole("button", { name: /Analyze/i }).first();
  await expect(analyze).toBeVisible({ timeout: 15_000 });
  await analyze.click();

  // Trigger the OCR call — our route mock will fire 503.
  const suggest = authedPage.getByRole("button", {
    name: /Suggest cards from photos/i,
  });
  await expect(suggest).toBeEnabled({ timeout: 15_000 });
  await suggest.click();

  // Banner + Retry render. The data-testid is the contract we set in
  // SuggestionsPanel.tsx for exactly this kind of e2e assertion.
  await expect(authedPage.getByTestId("ai-down-banner")).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    authedPage.getByText(/AI vision is temporarily unavailable/i)
  ).toBeVisible();
  await expect(
    authedPage.getByRole("button", { name: /^Retry$/i })
  ).toBeVisible();
  // Original trigger should be hidden once we're in the all-failed branch.
  await expect(suggest).toHaveCount(0);
});
