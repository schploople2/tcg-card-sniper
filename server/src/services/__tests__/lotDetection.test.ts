import { describe, it, expect } from "vitest";
import { detectLotShape } from "../lotDetection.js";

describe("detectLotShape", () => {
  describe("explicit lot keywords", () => {
    it.each([
      "Pokemon Charizard Lot of 10 cards",
      "Pokemon Base Set Bulk lot",
      "Vintage Pokemon collection 50 cards",
      "Pokemon binder full of holos",
      "Charizard + Pikachu bundle",
    ])("flags '%s' as a lot", (title) => {
      expect(detectLotShape(title).isLot).toBe(true);
    });

    it("does NOT match 'lot' as a substring inside other words", () => {
      // 'plot', 'allotment', 'Lotad' (a real Pokemon!) should NOT trigger.
      const s = detectLotShape("Pokemon Lotad Holo Rare");
      // Lotad has 'lot' inside it. The \b regex should reject this.
      // (If it ever does flag, the extractor will still produce a single
      // card so the cost is low — but we want the detection to be accurate.)
      const triggered = s.reasons.some((r) => r === "keyword:lot");
      expect(triggered).toBe(false);
    });
  });

  describe("explicit count markers", () => {
    it.each([
      ["Charizard x50 binder", 50],
      ["Pokemon (20) cards holo lot", 20],
      ["Vintage Pokemon 100 cards mixed", 100],
      ["Pokemon pack 30 ct", 30],
    ])("'%s' detects count %d", (title, count) => {
      const s = detectLotShape(title);
      expect(s.isLot).toBe(true);
      expect(s.explicitCount).toBe(count);
    });

    it("ignores small quantities (< 5) — those are per-card, not lots", () => {
      const s = detectLotShape("Charizard x3 base set");
      // x3 should not trigger the count heuristic; only the explicit lot
      // keyword would (and there isn't one here).
      expect(s.explicitCount).toBeNull();
    });
  });

  describe("separator density", () => {
    it("flags titles with ≥3 list separators", () => {
      const s = detectLotShape("Charizard, Pikachu, Mew, Eevee, Snorlax holos");
      expect(s.isLot).toBe(true);
      expect(s.reasons.some((r) => r.startsWith("separators:"))).toBe(true);
    });

    it("doesn't flag a clean single-card title", () => {
      expect(detectLotShape("Pokemon Charizard 4/102 Base Set Holo").isLot).toBe(false);
    });
  });

  describe("non-lot titles", () => {
    it.each([
      "Pokemon Charizard 4/102 Base Set Holo Rare",
      "Sylveon EX RC32 Generations Holo",
      "Jirachi GX 79a Unified Minds Alt Art",
    ])("'%s' is NOT a lot", (title) => {
      expect(detectLotShape(title).isLot).toBe(false);
    });
  });
});
