import { describe, it, expect } from "vitest";
import {
  containsFuzzy,
  levenshteinAtMost,
  noiseTermVariants,
} from "../misspellings.js";

describe("levenshteinAtMost", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinAtMost("charizard", "charizard", 2)).toBe(0);
  });

  it("counts single substitution", () => {
    // charizard vs charizrd — one deletion
    expect(levenshteinAtMost("charizard", "charizrd", 2)).toBe(1);
  });

  it("counts double edit (one insert + one substitute)", () => {
    expect(levenshteinAtMost("pokemon", "pokimoon", 3)).toBe(2);
  });

  it("early-exits when distance exceeds max", () => {
    // "cat" vs "elephant" can never be within 2 edits — returns max+1
    expect(levenshteinAtMost("cat", "elephant", 2)).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinAtMost("pokemon", "pokimon", 2)).toBe(
      levenshteinAtMost("pokimon", "pokemon", 2)
    );
  });
});

describe("containsFuzzy", () => {
  it("finds an exact substring", () => {
    expect(containsFuzzy("pokemon charizard mint", "charizard", 0)).toBe(true);
  });

  it("finds a single-edit misspelling inside a title", () => {
    // "Charzard" missing the 'i' — Levenshtein 1 from "charizard"
    expect(containsFuzzy("nm charzard base set", "charizard", 1)).toBe(true);
  });

  it("finds a two-edit misspelling", () => {
    // "Charzrd" missing two letters — Levenshtein 2 from "charizard"
    expect(containsFuzzy("pokmon charzrd holo", "charizard", 2)).toBe(true);
  });

  it("rejects distance > maxDist", () => {
    // "Pikachu" should NOT match "charizard" no matter how generous.
    expect(containsFuzzy("pikachu base set", "charizard", 2)).toBe(false);
  });

  it("documents the short-needle gotcha: 'mew' fuzzy-matches 'mewtwo' at maxDist=2", () => {
    // The caller compensates by tightening maxDist=0 for needles <5 chars;
    // we keep this test as the canonical "yes this is the contract" check.
    expect(containsFuzzy("mewtwo psa 9", "mew", 2)).toBe(true);
  });

  it("rejects unrelated titles cleanly", () => {
    expect(containsFuzzy("display case sleeve holder", "charizard", 2)).toBe(false);
  });
});

describe("noiseTermVariants", () => {
  it("substitutes 'pokemon' with common misspellings", () => {
    const variants = noiseTermVariants('"Charizard" pokemon mint');
    expect(variants.some((v) => v.includes("pokimon") || v.includes("pokmon"))).toBe(true);
  });

  it("returns empty list when query has no recognised noise terms", () => {
    expect(noiseTermVariants('"Mew" 25 Celebrations')).toEqual([]);
  });

  it("does not touch a card name even when its substring matches a noise word", () => {
    // 'card' is a noise word but appears INSIDE 'Charizard' — the word-
    // boundary replace must NOT swap it.
    const variants = noiseTermVariants('"Charizard" mint');
    expect(variants.every((v) => v.includes("Charizard"))).toBe(true);
  });

  it("caps the variant list to keep eBay round-trips bounded", () => {
    const variants = noiseTermVariants("pokemon card mint holographic rare");
    expect(variants.length).toBeLessThanOrEqual(3);
  });
});
