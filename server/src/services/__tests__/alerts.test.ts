import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import type { Prisma } from "@prisma/client";

/**
 * Mock the db module before importing the service under test. evaluateListings
 * is the only function in scope here; it should produce alert candidates and
 * hand them to prisma.alert.createMany with skipDuplicates.
 */
const createMany = vi.fn().mockResolvedValue({ count: 0 });
// B1 (rys session): evaluateListings now does a findMany pre-check on alerts
// to know which candidates are genuinely new (for Discord fan-out), and looks
// up the user's webhook URL + the listing data when fanning out. Mock them
// all; default to "no existing alerts, no webhook configured" so the
// fan-out is a no-op for these tests.
const alertFindMany = vi.fn().mockResolvedValue([]);
const userFindUnique = vi.fn().mockResolvedValue(null);
const listingFindMany = vi.fn().mockResolvedValue([]);

vi.mock("../../db.js", () => ({
  prisma: {
    alert: { createMany, findMany: alertFindMany },
    user: { findUnique: userFindUnique },
    listing: { findMany: listingFindMany },
  },
}));

// Dynamic import AFTER mock setup — otherwise the real db module is bound.
// Hoisted via beforeAll so we don't need top-level await (which the tsc
// CommonJS target rejects, even though vitest itself handles it fine).
let evaluateListings: typeof import("../alerts.js").evaluateListings;
beforeAll(async () => {
  ({ evaluateListings } = await import("../alerts.js"));
});

beforeEach(() => {
  createMany.mockClear();
  createMany.mockResolvedValue({ count: 0 });
  alertFindMany.mockClear();
  alertFindMany.mockResolvedValue([]);
  userFindUnique.mockClear();
  userFindUnique.mockResolvedValue(null);
  listingFindMany.mockClear();
  listingFindMany.mockResolvedValue([]);
});

function makeListing(over: Partial<{ id: string; totalCost: number; dealTier: string }> = {}) {
  return {
    id: over.id ?? "listing-1",
    totalCost: over.totalCost ?? 50,
    dealTier: over.dealTier ?? "FAIR",
  };
}

describe("evaluateListings", () => {
  const card = {
    id: "card-abc",
    userId: "user-xyz",
    targetPrice: 60 as unknown as Prisma.Decimal,
  };

  it("returns 0 immediately when no listings", async () => {
    const n = await evaluateListings(card, []);
    expect(n).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("creates a TARGET_HIT row when totalCost ≤ targetPrice", async () => {
    createMany.mockResolvedValueOnce({ count: 1 });
    const n = await evaluateListings(card, [
      makeListing({ id: "L1", totalCost: 55, dealTier: "GOOD" }),
    ]);
    expect(n).toBe(1);
    expect(createMany).toHaveBeenCalledOnce();
    const arg = createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toEqual([
      {
        userId: "user-xyz",
        cardId: "card-abc",
        listingId: "L1",
        kind: "TARGET_HIT",
      },
    ]);
  });

  it("creates a HOT_DEAL row when dealTier=HOT, even without a target", async () => {
    const noTarget = { id: "card-abc", userId: "user-xyz", targetPrice: null };
    createMany.mockResolvedValueOnce({ count: 1 });
    const n = await evaluateListings(noTarget, [
      makeListing({ id: "L2", totalCost: 200, dealTier: "HOT" }),
    ]);
    expect(n).toBe(1);
    expect(createMany.mock.calls[0][0].data).toEqual([
      {
        userId: "user-xyz",
        cardId: "card-abc",
        listingId: "L2",
        kind: "HOT_DEAL",
      },
    ]);
  });

  it("creates BOTH kinds when a listing is HOT *and* below target", async () => {
    createMany.mockResolvedValueOnce({ count: 2 });
    const n = await evaluateListings(card, [
      makeListing({ id: "L3", totalCost: 30, dealTier: "HOT" }),
    ]);
    expect(n).toBe(2);
    const kinds = createMany.mock.calls[0][0].data.map((d: { kind: string }) => d.kind);
    expect(kinds).toContain("TARGET_HIT");
    expect(kinds).toContain("HOT_DEAL");
  });

  it("emits nothing for a non-hot listing above target", async () => {
    const n = await evaluateListings(card, [
      makeListing({ id: "L4", totalCost: 100, dealTier: "FAIR" }),
    ]);
    expect(n).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("handles a Decimal targetPrice without losing precision (cents comparison)", async () => {
    // 60.00 represented as Decimal — listing at $59.99 = 5999¢ ≤ 6000¢, should fire.
    // Listing at $60.01 = 6001¢ > 6000¢, should not.
    const decimalCard = {
      id: "card-abc",
      userId: "user-xyz",
      targetPrice: { toString: () => "60.00" } as unknown as Prisma.Decimal,
    };

    createMany.mockResolvedValueOnce({ count: 1 });
    await evaluateListings(decimalCard, [
      makeListing({ id: "L5", totalCost: 59.99, dealTier: "FAIR" }),
    ]);
    expect(createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ listingId: "L5", kind: "TARGET_HIT" }),
    ]);

    createMany.mockClear();
    createMany.mockResolvedValueOnce({ count: 0 });
    await evaluateListings(decimalCard, [
      makeListing({ id: "L6", totalCost: 60.01, dealTier: "FAIR" }),
    ]);
    expect(createMany).not.toHaveBeenCalled();
  });
});
