import { describe, it, expect } from "vitest";
import { scoreLot } from "../lotValuation.js";

describe("scoreLot — tier math", () => {
  it("UNSCORED when lowEstimate is 0 (no priced cards)", () => {
    const r = scoreLot(50, 0);
    expect(r.lotTier).toBe("UNSCORED");
    expect(r.lotScore).toBe(0);
  });

  it("HOT when total is >25% below the conservative value", () => {
    // estimate $100, listing $50 → 50% under → HOT
    const r = scoreLot(50, 100);
    expect(r.lotScore).toBe(50);
    expect(r.lotTier).toBe("HOT");
  });

  it("GOOD when 11–25% under", () => {
    const r = scoreLot(80, 100); // 20%
    expect(r.lotScore).toBe(20);
    expect(r.lotTier).toBe("GOOD");
  });

  it("FAIR when 0–10% under", () => {
    const r = scoreLot(95, 100); // 5%
    expect(r.lotScore).toBe(5);
    expect(r.lotTier).toBe("FAIR");
  });

  it("OVER when listing exceeds even the conservative value", () => {
    const r = scoreLot(150, 100);
    expect(r.lotScore).toBe(-50);
    expect(r.lotTier).toBe("OVER");
  });

  it.each([
    [75, 100, "GOOD"], // 25% — boundary, stays GOOD
    [74, 100, "HOT"],  // 26% — flips to HOT
    [90, 100, "FAIR"], // 10% — boundary, stays FAIR
    [89, 100, "GOOD"], // 11% — flips to GOOD
  ])("boundary: total $%d vs low $%d → %s", (cost, low, tier) => {
    expect(scoreLot(cost, low).lotTier).toBe(tier);
  });
});
