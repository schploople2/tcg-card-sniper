import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

// vi.mock factories are hoisted, so prisma mocks must be declared via
// vi.hoisted to be visible inside the factory.
const { savedLotSearchFindMany } = vi.hoisted(() => ({
  savedLotSearchFindMany: vi.fn(),
}));

vi.mock("../../db.js", () => ({
  prisma: {
    savedLotSearch: { findMany: savedLotSearchFindMany },
  },
}));

import { tokeniseQuery, matchesQuery, passesFilters } from "../savedLotSearches.js";

/**
 * a2l (B4) — savedLotSearches query/filter helpers.
 *
 * Pure functions (tokeniseQuery, matchesQuery, passesFilters) tested
 * directly. matchUsersForLot is tested with a mocked prisma at the
 * bottom.
 */

describe("tokeniseQuery", () => {
  it("splits on whitespace and lowercases", () => {
    expect(tokeniseQuery("Charizard 1st Edition LOT")).toEqual([
      "charizard",
      "1st",
      "edition",
      "lot",
    ]);
  });
  it("drops empty tokens from extra spaces", () => {
    expect(tokeniseQuery("  pikachu   ex  ")).toEqual(["pikachu", "ex"]);
  });
  it("returns empty array for blank input", () => {
    expect(tokeniseQuery("   ")).toEqual([]);
  });
});

describe("matchesQuery — AND semantics", () => {
  it("matches when every token appears in the title (case-insensitive)", () => {
    expect(matchesQuery("Pokemon Charizard 1st Edition Lot", "charizard 1st")).toBe(
      true
    );
    expect(matchesQuery("Mega Floette Chaos Rising Lot", "chaos rising lot")).toBe(
      true
    );
  });
  it("rejects when any token is missing", () => {
    expect(matchesQuery("Pokemon Charizard Lot", "charizard 1st edition")).toBe(
      false
    );
  });
  it("rejects empty query", () => {
    expect(matchesQuery("Anything", "")).toBe(false);
  });
  it("substring matches are intentional (no word-boundary requirement)", () => {
    // 'gen' would match 'generations' — accepted as v1 behavior.
    expect(matchesQuery("Pokemon Generations Holo Lot", "gen lot")).toBe(true);
  });
});

describe("passesFilters", () => {
  const lot = { lowEstimate: 50 as unknown, listingPrice: 20 as unknown };
  it("passes when no filters set", () => {
    expect(passesFilters(lot, { minLowEstimate: null, maxAskingPrice: null })).toBe(
      true
    );
  });
  it("respects minLowEstimate floor", () => {
    expect(passesFilters(lot, { minLowEstimate: 40 as unknown, maxAskingPrice: null })).toBe(true);
    expect(passesFilters(lot, { minLowEstimate: 100 as unknown, maxAskingPrice: null })).toBe(false);
  });
  it("respects maxAskingPrice ceiling", () => {
    expect(passesFilters(lot, { minLowEstimate: null, maxAskingPrice: 25 as unknown })).toBe(true);
    expect(passesFilters(lot, { minLowEstimate: null, maxAskingPrice: 10 as unknown })).toBe(false);
  });
});

describe("matchUsersForLot", () => {
  let matchUsersForLot: typeof import("../savedLotSearches.js").matchUsersForLot;
  beforeAll(async () => {
    ({ matchUsersForLot } = await import("../savedLotSearches.js"));
  });
  beforeEach(() => {
    savedLotSearchFindMany.mockReset();
  });

  it("returns the userIds whose query+filters match the lot", async () => {
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "charizard 1st", minLowEstimate: null, maxAskingPrice: null },
      { userId: "user-2", query: "pikachu", minLowEstimate: null, maxAskingPrice: null },
      { userId: "user-3", query: "charizard", minLowEstimate: 200, maxAskingPrice: null }, // floor too high
    ]);
    const lot = {
      title: "Pokemon Charizard 1st Edition Lot",
      lowEstimate: 100 as unknown,
      listingPrice: 50 as unknown,
    };
    const ids = await matchUsersForLot(lot);
    expect(ids.sort()).toEqual(["user-1"]); // user-2 query doesn't match; user-3 floor blocks
  });

  it("dedupes when a user has multiple matching searches", async () => {
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "charizard", minLowEstimate: null, maxAskingPrice: null },
      { userId: "user-1", query: "1st edition", minLowEstimate: null, maxAskingPrice: null },
    ]);
    const lot = {
      title: "Pokemon Charizard 1st Edition Lot",
      lowEstimate: 100 as unknown,
      listingPrice: 50 as unknown,
    };
    const ids = await matchUsersForLot(lot);
    expect(ids).toEqual(["user-1"]);
  });

  it("returns empty when no save matches", async () => {
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "blastoise", minLowEstimate: null, maxAskingPrice: null },
    ]);
    const ids = await matchUsersForLot({
      title: "Pokemon Charizard Lot",
      lowEstimate: 100 as unknown,
      listingPrice: 50 as unknown,
    });
    expect(ids).toEqual([]);
  });
});
