import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * d5x (D2) — evaluateListingsForWatchedSellers behavior.
 */

const { watchedSellerFindMany, alertFindMany, alertCreateMany, userFindMany, listingFindMany } =
  vi.hoisted(() => ({
    watchedSellerFindMany: vi.fn(),
    alertFindMany: vi.fn(),
    alertCreateMany: vi.fn(),
    userFindMany: vi.fn(),
    listingFindMany: vi.fn(),
  }));

vi.mock("../../db.js", () => ({
  prisma: {
    watchedSeller: { findMany: watchedSellerFindMany },
    alert: { findMany: alertFindMany, createMany: alertCreateMany },
    user: { findMany: userFindMany },
    listing: { findMany: listingFindMany },
  },
}));

const { postToDiscord } = vi.hoisted(() => ({ postToDiscord: vi.fn() }));
vi.mock("../discordNotifier.js", async () => {
  const actual: typeof import("../discordNotifier.js") = await vi.importActual(
    "../discordNotifier.js"
  );
  return { ...actual, postToDiscord };
});

let evaluateListingsForWatchedSellers: typeof import("../alerts.js").evaluateListingsForWatchedSellers;
beforeAll(async () => {
  ({ evaluateListingsForWatchedSellers } = await import("../alerts.js"));
});

beforeEach(() => {
  watchedSellerFindMany.mockReset();
  alertFindMany.mockReset();
  alertCreateMany.mockReset();
  userFindMany.mockReset();
  listingFindMany.mockReset();
  postToDiscord.mockReset();

  alertFindMany.mockResolvedValue([]);
  alertCreateMany.mockResolvedValue({ count: 0 });
  userFindMany.mockResolvedValue([]);
  listingFindMany.mockResolvedValue([]);
  postToDiscord.mockResolvedValue({ ok: true, status: 204 });
});

describe("evaluateListingsForWatchedSellers", () => {
  it("returns 0 when no listings have a seller", async () => {
    const n = await evaluateListingsForWatchedSellers([
      { id: "L1", seller: null },
      { id: "L2", seller: "" },
    ]);
    expect(n).toBe(0);
    expect(watchedSellerFindMany).not.toHaveBeenCalled();
  });

  it("returns 0 when no WatchedSeller matches any listing's seller", async () => {
    watchedSellerFindMany.mockResolvedValue([]);
    const n = await evaluateListingsForWatchedSellers([
      { id: "L1", seller: "kstamps-2015" },
    ]);
    expect(n).toBe(0);
    expect(alertCreateMany).not.toHaveBeenCalled();
  });

  it("creates one SELLER_LISTING per (user, listing) match (case-insensitive)", async () => {
    watchedSellerFindMany.mockResolvedValue([
      { userId: "user-1", sellerName: "Kstamps-2015" },
      { userId: "user-2", sellerName: "kstamps-2015" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 2 });

    const n = await evaluateListingsForWatchedSellers([
      { id: "L1", seller: "kstamps-2015" },
    ]);
    expect(n).toBe(2);
    const data = alertCreateMany.mock.calls[0][0].data as Array<{
      userId: string;
      listingId: string;
      kind: string;
    }>;
    expect(data.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: "user-1", listingId: "L1", kind: "SELLER_LISTING" },
      { userId: "user-2", listingId: "L1", kind: "SELLER_LISTING" },
    ]);
  });

  it("skips dedup when alert already exists for (user, listing, SELLER_LISTING)", async () => {
    watchedSellerFindMany.mockResolvedValue([
      { userId: "user-1", sellerName: "foo" },
    ]);
    alertFindMany.mockResolvedValue([{ userId: "user-1", listingId: "L1" }]);
    alertCreateMany.mockResolvedValue({ count: 0 });

    await evaluateListingsForWatchedSellers([{ id: "L1", seller: "foo" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(postToDiscord).not.toHaveBeenCalled();
  });

  it("fans out to Discord only for novel alerts when webhook is set", async () => {
    watchedSellerFindMany.mockResolvedValue([
      { userId: "user-1", sellerName: "foo" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([
      { id: "user-1", discordWebhookUrl: "https://discord.com/api/webhooks/9/abc" },
    ]);
    listingFindMany.mockResolvedValue([
      {
        id: "L1",
        title: "Cool listing from foo",
        imageUrl: null,
        ebayUrl: "https://ebay.com/itm/x",
        totalCost: 25,
        marketPrice: 30,
        condition: "NM",
        dealTier: "GOOD",
        seller: "foo",
      },
    ]);

    await evaluateListingsForWatchedSellers([{ id: "L1", seller: "foo" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(postToDiscord).toHaveBeenCalledOnce();
    expect(postToDiscord.mock.calls[0][0]).toBe(
      "https://discord.com/api/webhooks/9/abc"
    );
  });

  it("doesn't crash when the matched user has no Discord webhook configured", async () => {
    watchedSellerFindMany.mockResolvedValue([
      { userId: "user-1", sellerName: "foo" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });
    userFindMany.mockResolvedValue([
      { id: "user-1", discordWebhookUrl: null },
    ]);
    listingFindMany.mockResolvedValue([
      {
        id: "L1",
        title: "x",
        imageUrl: null,
        ebayUrl: "https://x",
        totalCost: 1,
        marketPrice: null,
        condition: null,
        dealTier: null,
        seller: "foo",
      },
    ]);
    await evaluateListingsForWatchedSellers([{ id: "L1", seller: "foo" }]);
    await new Promise((r) => setTimeout(r, 10));
    expect(postToDiscord).not.toHaveBeenCalled();
  });
});
