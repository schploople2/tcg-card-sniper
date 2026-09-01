import { describe, it, expect } from "vitest";
import { annotatePortfolioItem, type PortfolioItemRow } from "../portfolio.js";

function item(over: Partial<PortfolioItemRow> = {}): PortfolioItemRow {
  return {
    id: "item-1",
    cardId: "base1-4",
    label: null,
    variant: "holofoil",
    kind: "raw",
    gradingCompany: null,
    grade: null,
    quantity: 1,
    acquisitionPrice: 100,
    acquiredAt: new Date("2026-01-01"),
    notes: null,
    card: {
      id: "base1-4",
      name: "Charizard",
      number: "4",
      setName: "Base Set",
      imageSmall: null,
      tcgplayerPrices: { holofoil: { market: 150 } },
      cardmarketPrices: null,
    },
    ...over,
  };
}

describe("annotatePortfolioItem", () => {
  it("resolves current market from the tcgplayer tier and computes unrealized P&L", () => {
    const out = annotatePortfolioItem(item());
    expect(out.currentMarket).toBe(150);
    expect(out.totalCost).toBe(100);
    expect(out.currentValue).toBe(150);
    expect(out.unrealizedPnl).toBe(50);
    expect(out.priceSource).toBe("tcgplayer");
  });

  it("scales cost/value by quantity", () => {
    const out = annotatePortfolioItem(item({ quantity: 3, acquisitionPrice: 100 }));
    expect(out.totalCost).toBe(300);
    expect(out.currentValue).toBe(450);
    expect(out.unrealizedPnl).toBe(150);
  });

  it("falls back to cardmarket when tcgplayer has no data for the variant", () => {
    const out = annotatePortfolioItem(
      item({
        variant: "reverseHolofoil",
        card: {
          id: "base1-4",
          name: "Charizard",
          number: "4",
          setName: "Base Set",
          imageSmall: null,
          tcgplayerPrices: { holofoil: { market: 150 } },
          cardmarketPrices: { trendPrice: 80 },
        },
      })
    );
    expect(out.currentMarket).toBe(80);
    expect(out.priceSource).toBe("cardmarket");
    expect(out.priceCurrency).toBe("EUR");
  });

  it("reports null pricing (not zero) when nothing resolves, so P&L stays unknown", () => {
    const out = annotatePortfolioItem(
      item({
        card: {
          id: "base1-4",
          name: "Charizard",
          number: "4",
          setName: "Base Set",
          imageSmall: null,
          tcgplayerPrices: null,
          cardmarketPrices: null,
        },
      })
    );
    expect(out.currentMarket).toBeNull();
    expect(out.currentValue).toBeNull();
    expect(out.unrealizedPnl).toBeNull();
    expect(out.priceSource).toBe("none");
  });

  it("uses label as the display name for sealed product with no card row", () => {
    const out = annotatePortfolioItem(
      item({
        cardId: null,
        card: null,
        variant: null,
        kind: "sealed",
        label: "Scarlet & Violet Booster Box",
        acquisitionPrice: 120,
      })
    );
    expect(out.label).toBe("Scarlet & Violet Booster Box");
    expect(out.currentMarket).toBeNull();
    expect(out.totalCost).toBe(120);
  });

  it("carries grading fields through for graded items", () => {
    const out = annotatePortfolioItem(
      item({ kind: "graded", gradingCompany: "PSA", grade: "10" })
    );
    expect(out.gradingCompany).toBe("PSA");
    expect(out.grade).toBe("10");
  });
});
