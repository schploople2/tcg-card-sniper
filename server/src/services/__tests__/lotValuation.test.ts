import { describe, it, expect } from "vitest";
import { scoreLot, applyHints, mergeTitleAndVisionParsed } from "../lotValuation.js";

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

describe("applyHints — set + number narrowing", () => {
  const candidates = [
    { id: "base-4", number: "4", setName: "Base Set" },
    { id: "base2-4", number: "4", setName: "Base Set 2" },
    { id: "fates-12", number: "12", setName: "Paldean Fates" },
    { id: "jungle-3", number: "3", setName: "Jungle" },
  ];

  it("returns the full bucket when no hints provided", () => {
    expect(applyHints(candidates, null, null)).toHaveLength(4);
    expect(applyHints(candidates, undefined, undefined)).toHaveLength(4);
  });

  it("filters by exact card number", () => {
    const out = applyHints(candidates, null, "4");
    expect(out.map((c) => c.id).sort()).toEqual(["base-4", "base2-4"]);
  });

  it("strips '/N' denominator from vision-style card numbers", () => {
    const out = applyHints(candidates, null, "4/102");
    expect(out.map((c) => c.id).sort()).toEqual(["base-4", "base2-4"]);
  });

  it("filters by set name with case-insensitive substring", () => {
    const out = applyHints(candidates, "base set", null);
    expect(out.map((c) => c.id).sort()).toEqual(["base-4", "base2-4"]);
  });

  it("requires forward containment (catalog set must contain the hint)", () => {
    // Hint is shorter than catalog set name — forward match works.
    expect(applyHints([{ id: "y", number: "1", setName: "Base Set" }], "base", null)).toHaveLength(1);
    // Hint is more specific than catalog (would have matched in either-direction
    // mode). Soft fallback returns the bucket unfiltered rather than dropping it.
    expect(applyHints([{ id: "x", number: "1", setName: "Base" }], "Base Set", null)).toHaveLength(1);
  });

  it("combines set + number additively", () => {
    const out = applyHints(candidates, "base set 2", "4");
    expect(out.map((c) => c.id)).toEqual(["base2-4"]);
  });

  it("falls back to the full bucket when filtering empties it (soft filter)", () => {
    // Hint matches nothing → return everything rather than dropping the card.
    const out = applyHints(candidates, "Team Rocket Returns", "999");
    expect(out).toHaveLength(4);
  });

  it("does not filter an already-empty bucket", () => {
    expect(applyHints([], "anything", "1")).toEqual([]);
  });
});

describe("mergeTitleAndVisionParsed", () => {
  it("returns vision-only when title parsedCards is empty / null / non-array", () => {
    const vision = [{ name: "Charizard", quantity: 1, confidence: 0.9 }];
    expect(mergeTitleAndVisionParsed(null, vision)).toEqual([
      { name: "Charizard", quantity: 1, confidence: 0.9, setHint: null, cardNumber: null },
    ]);
    expect(mergeTitleAndVisionParsed([], vision)).toHaveLength(1);
    expect(mergeTitleAndVisionParsed("garbage", vision)).toHaveLength(1);
  });

  it("returns title-only when vision is empty", () => {
    const title = [{ name: "Mewtwo", quantity: 2, confidence: 0.5 }];
    const out = mergeTitleAndVisionParsed(title, []);
    expect(out).toEqual([
      { name: "Mewtwo", quantity: 2, confidence: 0.5, setHint: null, cardNumber: null },
    ]);
  });

  it("unions distinct names across title + vision", () => {
    const out = mergeTitleAndVisionParsed(
      [{ name: "Pikachu", quantity: 1, confidence: 0.5 }],
      [{ name: "Gengar", quantity: 1, confidence: 0.9, setHint: "Fossil", cardNumber: "5" }]
    );
    expect(out.map((c) => c.name).sort()).toEqual(["Gengar", "Pikachu"]);
    const gengar = out.find((c) => c.name === "Gengar")!;
    expect(gengar.setHint).toBe("Fossil");
    expect(gengar.cardNumber).toBe("5");
  });

  it("merges duplicates by max quantity + max confidence, vision contributes hints", () => {
    const out = mergeTitleAndVisionParsed(
      [{ name: "Charizard", quantity: 1, confidence: 0.6 }],
      [{ name: "Charizard", quantity: 3, confidence: 0.95, setHint: "Base Set", cardNumber: "4/102" }]
    );
    expect(out).toHaveLength(1);
    expect(out[0].quantity).toBe(3);
    expect(out[0].confidence).toBe(0.95);
    expect(out[0].setHint).toBe("Base Set");
    expect(out[0].cardNumber).toBe("4/102");
  });

  it("preserves max quantity when title has the larger value", () => {
    const out = mergeTitleAndVisionParsed(
      [{ name: "Pikachu", quantity: 10, confidence: 0.7 }],
      [{ name: "Pikachu", quantity: 1, confidence: 0.5 }]
    );
    expect(out[0].quantity).toBe(10);
    expect(out[0].confidence).toBe(0.7);
  });

  it("case-insensitive dedupe by name", () => {
    const out = mergeTitleAndVisionParsed(
      [{ name: "PIKACHU", quantity: 1, confidence: 0.5 }],
      [{ name: "pikachu", quantity: 2, confidence: 0.9 }]
    );
    expect(out).toHaveLength(1);
    // Vision wins on the display-case since it overwrites.
    expect(out[0].name).toBe("pikachu");
  });

  it("ignores title entries with non-string names", () => {
    const out = mergeTitleAndVisionParsed(
      [{ name: 42, quantity: 1, confidence: 0.5 }, { name: "Eevee", quantity: 1, confidence: 0.5 }],
      []
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Eevee");
  });
});
