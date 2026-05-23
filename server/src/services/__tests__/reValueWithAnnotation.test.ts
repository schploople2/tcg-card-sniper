import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * fqi — reValueWithAnnotation unit tests.
 *
 * Focus is the name-based supersession added in dgc: when a user-added card's
 * Card.name matches the name of an AI-parsed suggestion in Lot.parsedCards,
 * the AI's contribution to autoLow/autoHigh must be dropped so we don't
 * double-count alongside the user's explicit printing pick.
 */

const lotFindUnique = vi.fn();
const cardFindMany = vi.fn();

vi.mock("../../db.js", () => ({
  prisma: {
    lot: { findUnique: lotFindUnique },
    card: { findMany: cardFindMany },
  },
}));

let reValueWithAnnotation: typeof import("../lotValuation.js").reValueWithAnnotation;

beforeAll(async () => {
  ({ reValueWithAnnotation } = await import("../lotValuation.js"));
});

beforeEach(() => {
  lotFindUnique.mockReset();
  cardFindMany.mockReset();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Mew Vmax candidates: a cheap base printing ($15) and a mid alt ($20). */
const mewVmaxParsed = {
  name: "Mew Vmax",
  quantity: 1,
  confidence: 0.9,
  candidates: [
    { cardId: "swsh8-114", setName: "Fusion Strike", number: "114", market: 15, currency: "USD" },
    { cardId: "swsh-promo-1", setName: "Promo", number: "P1", market: 20, currency: "USD" },
  ],
};

/** Suicune V candidate, single printing $30. */
const suicuneVParsed = {
  name: "Suicune V",
  quantity: 1,
  confidence: 0.85,
  candidates: [
    { cardId: "swsh9-31", setName: "Brilliant Stars", number: "31", market: 30, currency: "USD" },
  ],
};

/** The Card row a user picks to "correct" the Mew Vmax suggestion. */
const mewVmaxAltArtCardRow = {
  id: "swsh8-269",
  name: "Mew Vmax",
  number: "269",
  setName: "Fusion Strike",
  tcgplayerPrices: { "1stEditionHolofoil": { market: 215 } },
  cardmarketPrices: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("reValueWithAnnotation — supersession", () => {
  it("drops the auto contribution for a parsed name superseded by an added card", async () => {
    lotFindUnique.mockResolvedValue({ parsedCards: [mewVmaxParsed] });
    cardFindMany.mockResolvedValue([mewVmaxAltArtCardRow]);

    const result = await reValueWithAnnotation("ebay-1", [
      { cardId: "swsh8-269", quantity: 1 },
    ]);

    // Mew Vmax superseded → no auto contribution
    expect(result.autoLowEstimate).toBe(0);
    expect(result.autoHighEstimate).toBe(0);
    // Only the user's $215 pick counts toward the with-annotation total
    expect(result.withAnnotationLowEstimate).toBe(215);
    expect(result.withAnnotationHighEstimate).toBe(215);
    // Summary reflects the resolved card row
    expect(result.addedCardSummaries).toEqual([
      {
        cardId: "swsh8-269",
        name: "Mew Vmax",
        number: "269",
        setName: "Fusion Strike",
        market: 215,
        quantity: 1,
        note: null,
      },
    ]);
  });

  it("supersedes only the matching name; other parsed cards still contribute", async () => {
    lotFindUnique.mockResolvedValue({ parsedCards: [mewVmaxParsed, suicuneVParsed] });
    cardFindMany.mockResolvedValue([mewVmaxAltArtCardRow]);

    const result = await reValueWithAnnotation("ebay-1", [
      { cardId: "swsh8-269", quantity: 1 },
    ]);

    // Suicune V is untouched: single candidate at $30 → low = high = 30
    expect(result.autoLowEstimate).toBe(30);
    expect(result.autoHighEstimate).toBe(30);
    // Suicune $30 + user's $215 pick = $245
    expect(result.withAnnotationLowEstimate).toBe(245);
    expect(result.withAnnotationHighEstimate).toBe(245);
  });

  it("computes auto totals from candidate min/max when no supersession applies", async () => {
    lotFindUnique.mockResolvedValue({ parsedCards: [mewVmaxParsed, suicuneVParsed] });
    cardFindMany.mockResolvedValue([]);

    const result = await reValueWithAnnotation("ebay-1", []);

    // Mew Vmax: min $15, max $20 → contributes [$15, $20]; Suicune adds $30 to each
    expect(result.autoLowEstimate).toBe(45);
    expect(result.autoHighEstimate).toBe(50);
    // No additions → with-annotation matches auto
    expect(result.withAnnotationLowEstimate).toBe(45);
    expect(result.withAnnotationHighEstimate).toBe(50);
    expect(result.addedCardSummaries).toEqual([]);
  });

  it("supersedes case-insensitively and ignoring surrounding whitespace", async () => {
    lotFindUnique.mockResolvedValue({
      parsedCards: [{ ...mewVmaxParsed, name: "  MEW vmax  " }],
    });
    cardFindMany.mockResolvedValue([mewVmaxAltArtCardRow]); // name: "Mew Vmax"

    const result = await reValueWithAnnotation("ebay-1", [
      { cardId: "swsh8-269", quantity: 1 },
    ]);

    expect(result.autoLowEstimate).toBe(0);
    expect(result.autoHighEstimate).toBe(0);
    expect(result.withAnnotationLowEstimate).toBe(215);
  });

  it("handles an added cardId that doesn't resolve to a Card row", async () => {
    lotFindUnique.mockResolvedValue({ parsedCards: [suicuneVParsed] });
    cardFindMany.mockResolvedValue([]); // user's cardId was deleted from the catalog

    const result = await reValueWithAnnotation("ebay-1", [
      { cardId: "ghost-123", quantity: 2 },
    ]);

    // Auto Suicune V still counts (no supersession — no name to match against)
    expect(result.autoLowEstimate).toBe(30);
    expect(result.autoHighEstimate).toBe(30);
    // Unknown card adds 0 value
    expect(result.withAnnotationLowEstimate).toBe(30);
    expect(result.withAnnotationHighEstimate).toBe(30);
    expect(result.addedCardSummaries[0]).toMatchObject({
      cardId: "ghost-123",
      name: "(unknown)",
      market: null,
      quantity: 2,
    });
  });

  it("returns zeros when the lot doesn't exist", async () => {
    lotFindUnique.mockResolvedValue(null);
    cardFindMany.mockResolvedValue([]);

    const result = await reValueWithAnnotation("ebay-missing", []);

    expect(result).toEqual({
      autoLowEstimate: 0,
      autoHighEstimate: 0,
      withAnnotationLowEstimate: 0,
      withAnnotationHighEstimate: 0,
      addedCardSummaries: [],
    });
  });
});
