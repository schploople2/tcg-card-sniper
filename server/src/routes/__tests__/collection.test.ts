import { describe, it, expect } from "vitest";
import { groupRadiantCards, rcNumber, type RadiantCardRow } from "../collection.js";

function card(over: Partial<RadiantCardRow> & { id: string; number: string; setId: string }): RadiantCardRow {
  return {
    name: "Pikachu",
    rarity: "Rare",
    setName: over.setId === "g1" ? "Generations" : "Legendary Treasures",
    imageSmall: null,
    imageLarge: null,
    ...over,
  };
}

describe("rcNumber", () => {
  it("parses RC<n>", () => {
    expect(rcNumber("RC1")).toBe(1);
    expect(rcNumber("RC10")).toBe(10);
    expect(rcNumber("RC32")).toBe(32);
  });
  it("returns a max sentinel for non-RC numbers so they sort last", () => {
    expect(rcNumber("12")).toBe(Number.MAX_SAFE_INTEGER);
    expect(rcNumber("XY-P")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("groupRadiantCards", () => {
  it("groups by set, preserves declared set order (Generations first)", () => {
    const out = groupRadiantCards(
      [
        card({ id: "bw11-rc1", number: "RC1", setId: "bw11" }),
        card({ id: "g1-rc1", number: "RC1", setId: "g1" }),
      ],
      [],
    );
    expect(out.sets.map((s) => s.setId)).toEqual(["g1", "bw11"]);
  });

  it("natural-sorts cards inside a set (RC1, RC2, RC10, RC32 — not lexical)", () => {
    const out = groupRadiantCards(
      [
        card({ id: "g1-rc10", number: "RC10", setId: "g1" }),
        card({ id: "g1-rc1", number: "RC1", setId: "g1" }),
        card({ id: "g1-rc32", number: "RC32", setId: "g1" }),
        card({ id: "g1-rc2", number: "RC2", setId: "g1" }),
      ],
      [],
    );
    const numbers = out.sets[0].cards.map((c) => c.number);
    expect(numbers).toEqual(["RC1", "RC2", "RC10", "RC32"]);
  });

  it("marks cards in the collectedCardIds set as collected", () => {
    const out = groupRadiantCards(
      [
        card({ id: "g1-rc1", number: "RC1", setId: "g1" }),
        card({ id: "g1-rc2", number: "RC2", setId: "g1" }),
      ],
      ["g1-rc1"],
    );
    expect(out.sets[0].cards.find((c) => c.id === "g1-rc1")?.collected).toBe(true);
    expect(out.sets[0].cards.find((c) => c.id === "g1-rc2")?.collected).toBe(false);
  });

  it("counts collected per set and across all sets", () => {
    const out = groupRadiantCards(
      [
        card({ id: "g1-rc1", number: "RC1", setId: "g1" }),
        card({ id: "g1-rc2", number: "RC2", setId: "g1" }),
        card({ id: "bw11-rc1", number: "RC1", setId: "bw11" }),
      ],
      ["g1-rc1", "bw11-rc1"],
    );
    expect(out.sets[0].collected).toBe(1); // g1
    expect(out.sets[1].collected).toBe(1); // bw11
    expect(out.collected).toBe(2);
  });

  it("reports declared totals (32 + 25 = 57) regardless of how many catalog rows are passed in", () => {
    const out = groupRadiantCards([], []);
    expect(out.total).toBe(57);
    expect(out.sets[0].total).toBe(32);
    expect(out.sets[1].total).toBe(25);
  });
});
