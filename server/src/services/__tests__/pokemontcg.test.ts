import { describe, it, expect } from "vitest";
import { subsetQuery } from "../pokemontcg.js";

describe("subsetQuery", () => {
  it("returns null for ordinary queries", () => {
    expect(subsetQuery("Charizard")).toBeNull();
    expect(subsetQuery("Mew ex")).toBeNull();
    expect(subsetQuery("Pikachu Promo")).toBeNull();
  });

  it("recognises 'Radiant Collection' across BW & XY parent sets", () => {
    const q = subsetQuery("Radiant Collection");
    // Should restrict to set.id IN (bw11, g1) with number prefix RC
    expect(q).toMatch(/set\.id:bw11/);
    expect(q).toMatch(/set\.id:g1/);
    expect(q).toMatch(/number:RC\*/);
  });

  it("recognises 'Trainer Gallery' (no parent restriction)", () => {
    // TG-numbered cards span many sets; we don't restrict on parent.
    const q = subsetQuery("Trainer Gallery");
    expect(q).toBe("number:TG*");
  });

  it("recognises 'Galarian Gallery' (Crown Zenith)", () => {
    const q = subsetQuery("Galarian Gallery");
    expect(q).toMatch(/swsh12pt5gg/);
    expect(q).toMatch(/number:GG\*/);
  });

  it("recognises 'Shiny Vault' (Hidden Fates)", () => {
    const q = subsetQuery("Shiny Vault");
    expect(q).toMatch(/set\.id:sm115/);
    expect(q).toMatch(/number:SV\*/);
  });

  it("is case-insensitive and forgiving on whitespace", () => {
    expect(subsetQuery("RADIANT COLLECTION")).not.toBeNull();
    expect(subsetQuery("radiant  collection")).not.toBeNull();
    // The `\s*` between words intentionally allows no-space too, so
    // "radiantcollection" still matches. Forgiving > strict on user input.
    expect(subsetQuery("Radiantcollection")).not.toBeNull();
  });

  it("does NOT trigger on partial-match within unrelated words", () => {
    // "Radiantix" is not a known subset and should not match the alias.
    expect(subsetQuery("Radiantix")).toBeNull();
    expect(subsetQuery("Gallerypiece")).toBeNull();
  });
});
