import { describe, it, expect } from "vitest";
import { computeMistitledScore } from "../mistitledScore.js";

/**
 * 2bp (A2) — pure function tests for the mistitled-score heuristic.
 */

function parsed(
  name: string,
  quantity: number,
  ...marketsPerCandidate: number[]
) {
  return {
    name,
    quantity,
    candidates: marketsPerCandidate.map((m) => ({ market: m })),
  };
}

describe("computeMistitledScore", () => {
  it("returns 0 when every parsed card name appears in the title", () => {
    const result = computeMistitledScore({
      title: "Pokemon Charizard Pikachu Lot NM",
      parsedCards: [parsed("Charizard", 1, 50), parsed("Pikachu", 1, 20)],
    });
    expect(result.hiddenUsd).toBe(0);
    expect(result.hidden).toEqual([]);
  });

  it("counts cards whose names are missing from the title", () => {
    const result = computeMistitledScore({
      title: "Pokemon Card Lot",
      parsedCards: [
        parsed("Charizard", 1, 300), // hidden, $300
        parsed("Pikachu", 2, 10, 15), // hidden, 2 × $15 = $30
      ],
    });
    expect(result.hiddenUsd).toBe(330);
    expect(result.hidden).toEqual([
      { name: "Charizard", quantity: 1, unitValue: 300, totalValue: 300 },
      { name: "Pikachu", quantity: 2, unitValue: 15, totalValue: 30 },
    ]);
  });

  it("considers a card 'named' if any of its tokens appears in the title", () => {
    // "Mega Charizard" has 'mega' and 'charizard' — title contains 'charizard',
    // so the card is considered named.
    const result = computeMistitledScore({
      title: "Pokemon Charizard Lot",
      parsedCards: [parsed("Mega Charizard", 1, 300)],
    });
    expect(result.hiddenUsd).toBe(0);
  });

  it("ignores cards with no priced candidates (unpriceable can't be 'value')", () => {
    const result = computeMistitledScore({
      title: "Mystery Bulk Lot",
      parsedCards: [parsed("Charizard", 1)], // no markets
    });
    expect(result.hiddenUsd).toBe(0);
  });

  it("uses the MAX market across a card's candidates (optimistic per-name)", () => {
    const result = computeMistitledScore({
      title: "Mystery Lot",
      parsedCards: [parsed("Charizard", 1, 50, 300, 100)],
    });
    expect(result.hidden[0]).toMatchObject({ unitValue: 300, totalValue: 300 });
  });

  it("sorts hidden cards by totalValue desc and rounds the total to cents", () => {
    const result = computeMistitledScore({
      title: "Mystery Lot",
      parsedCards: [
        parsed("Mewtwo", 1, 10),
        parsed("Charizard", 1, 99.999),
        parsed("Blastoise", 1, 50),
      ],
    });
    expect(result.hidden.map((h) => h.name)).toEqual([
      "Charizard",
      "Blastoise",
      "Mewtwo",
    ]);
    expect(result.hiddenUsd).toBe(160); // 99.999 rounds to 100; 100 + 50 + 10 = 160
  });

  it("returns 0 when the title is empty (defensive)", () => {
    const result = computeMistitledScore({
      title: "",
      parsedCards: [parsed("Charizard", 1, 300)],
    });
    expect(result.hiddenUsd).toBe(0);
  });

  it("handles malformed parsedCards JSON without crashing", () => {
    const result = computeMistitledScore({
      title: "Pokemon Lot",
      parsedCards: "not-an-array" as unknown,
    });
    expect(result).toEqual({ hiddenUsd: 0, hidden: [] });
  });
});
