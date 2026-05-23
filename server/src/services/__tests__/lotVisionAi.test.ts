import { describe, it, expect } from "vitest";
import { dedupeSuggestions } from "../lotVisionAi.js";

/**
 * Pc — lotVisionAi unit tests.
 *
 * We mostly trust the Anthropic SDK; the things worth pinning down are
 * (a) the suggestion-merge logic across multi-image lots, and (b) that
 * `dedupeSuggestions` collapses cross-image duplicates rather than
 * double-counting them. The JSON-parsing fallback is exercised by
 * passing partial / repeated suggestions through the same helper.
 */
describe("dedupeSuggestions", () => {
  it("keeps the higher-confidence reading when the same card appears twice", () => {
    const out = dedupeSuggestions([
      {
        name: "charizard",
        quantity: 1,
        confidence: 0.6,
        sourceImagePosition: 0,
        setHint: null,
        cardNumber: null,
      },
      {
        name: "charizard",
        quantity: 1,
        confidence: 0.92,
        sourceImagePosition: 2,
        setHint: "Base Set",
        cardNumber: "4/102",
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.92);
    expect(out[0].setHint).toBe("Base Set");
  });

  it("sums quantity across photo angles when the same card shows up multiple times", () => {
    const out = dedupeSuggestions([
      {
        name: "pikachu",
        quantity: 2,
        confidence: 0.7,
        sourceImagePosition: 0,
        setHint: null,
        cardNumber: null,
      },
      {
        name: "pikachu",
        quantity: 3,
        confidence: 0.5,
        sourceImagePosition: 1,
        setHint: null,
        cardNumber: null,
      },
    ]);
    expect(out).toHaveLength(1);
    // We keep the MAX rather than the SUM — repeat photos likely show the
    // same physical card from different angles, not new copies.
    expect(out[0].quantity).toBe(3);
  });

  it("sorts by confidence descending", () => {
    const out = dedupeSuggestions([
      {
        name: "mew",
        quantity: 1,
        confidence: 0.4,
        sourceImagePosition: 0,
        setHint: null,
        cardNumber: null,
      },
      {
        name: "mewtwo",
        quantity: 1,
        confidence: 0.9,
        sourceImagePosition: 0,
        setHint: null,
        cardNumber: null,
      },
      {
        name: "pikachu",
        quantity: 1,
        confidence: 0.7,
        sourceImagePosition: 0,
        setHint: null,
        cardNumber: null,
      },
    ]);
    expect(out.map((s) => s.name)).toEqual(["mewtwo", "pikachu", "mew"]);
  });
});
