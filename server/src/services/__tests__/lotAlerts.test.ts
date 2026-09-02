import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * 0hj (A1) — evaluateLotAfterOcr threshold + fan-out behavior.
 *
 * Mocks Prisma to drive the lot value range and the user/webhook lookups.
 * Doesn't actually hit Discord — postToDiscord is mocked.
 */

const lotFindUnique = vi.fn();
const userFindMany = vi.fn();
const alertFindMany = vi.fn();
const alertCreateMany = vi.fn();
// B4: lotAlerts now scopes via SavedLotSearch instead of all users.
const savedLotSearchFindMany = vi.fn();

vi.mock("../../db.js", () => ({
  prisma: {
    lot: { findUnique: lotFindUnique },
    user: { findMany: userFindMany },
    alert: { findMany: alertFindMany, createMany: alertCreateMany },
    savedLotSearch: { findMany: savedLotSearchFindMany },
  },
}));

const postToDiscord = vi.fn();
vi.mock("../discordNotifier.js", async () => {
  const actual: typeof import("../discordNotifier.js") = await vi.importActual(
    "../discordNotifier.js"
  );
  return { ...actual, postToDiscord };
});

let evaluateLotAfterOcr: typeof import("../lotAlerts.js").evaluateLotAfterOcr;

beforeAll(async () => {
  ({ evaluateLotAfterOcr } = await import("../lotAlerts.js"));
});

beforeEach(() => {
  lotFindUnique.mockReset();
  userFindMany.mockReset();
  alertFindMany.mockReset();
  alertCreateMany.mockReset();
  postToDiscord.mockReset();
  savedLotSearchFindMany.mockReset();
  // sensible defaults
  alertFindMany.mockResolvedValue([]);
  alertCreateMany.mockResolvedValue({ count: 0 });
  userFindMany.mockResolvedValue([]);
  savedLotSearchFindMany.mockResolvedValue([]);
  postToDiscord.mockResolvedValue({ ok: true, status: 204 });
});

function lotFixture(over: Partial<{
  ebayItemId: string;
  listingPrice: number;
  lowEstimate: number;
  highEstimate: number;
  lotTier: string;
  parsedCards: unknown;
  title: string;
  ebayUrl: string;
  imageUrl: string | null;
}> = {}) {
  return {
    ebayItemId: "ebay-1",
    listingPrice: 50,
    lowEstimate: 200,
    highEstimate: 400,
    lotTier: "HOT",
    parsedCards: [],
    title: "Big lot",
    ebayUrl: "https://ebay.com/itm/1",
    imageUrl: "https://e/1.jpg",
    ...over,
  };
}

describe("evaluateLotAfterOcr — threshold", () => {
  it("fires when lot is HOT and low estimate ≥ 2× listing price ≥ MIN_LOW", async () => {
    lotFindUnique.mockResolvedValue(lotFixture({ listingPrice: 50, lowEstimate: 200 }));
    // B4: user-1 has a saved search matching the lot title "Big lot"
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    userFindMany.mockResolvedValueOnce([
      { id: "user-1", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc" },
    ]); // fan-out lookup

    alertCreateMany.mockResolvedValue({ count: 1 });

    const result = await evaluateLotAfterOcr("ebay-1");
    expect(result.qualified).toBe(true);
    expect(result.alertsCreated).toBe(1);
    expect(alertCreateMany).toHaveBeenCalledOnce();
    const data = alertCreateMany.mock.calls[0][0].data as Array<{
      userId: string;
      lotEbayItemId: string;
      kind: string;
    }>;
    expect(data).toEqual([
      { userId: "user-1", lotEbayItemId: "ebay-1", kind: "LOT_HOT" },
    ]);
  });

  it("skips when lotTier is not HOT", async () => {
    lotFindUnique.mockResolvedValue(lotFixture({ lotTier: "GOOD" }));
    const result = await evaluateLotAfterOcr("ebay-1");
    expect(result.qualified).toBe(false);
    expect(alertCreateMany).not.toHaveBeenCalled();
  });

  it("skips when lowEstimate < 2× listing price (insufficient discount)", async () => {
    lotFindUnique.mockResolvedValue(lotFixture({ listingPrice: 100, lowEstimate: 150 }));
    const result = await evaluateLotAfterOcr("ebay-1");
    expect(result.qualified).toBe(false);
  });

  it("skips when lowEstimate is below the dollar floor (don't spam $1 lots)", async () => {
    lotFindUnique.mockResolvedValue(
      lotFixture({ listingPrice: 1, lowEstimate: 19, lotTier: "HOT" })
    );
    const result = await evaluateLotAfterOcr("ebay-1");
    expect(result.qualified).toBe(false);
  });

  it("skips when the lot row doesn't exist", async () => {
    lotFindUnique.mockResolvedValue(null);
    const result = await evaluateLotAfterOcr("ebay-missing");
    expect(result.qualified).toBe(false);
    expect(result.alertsCreated).toBe(0);
  });
});

describe("evaluateLotAfterOcr — fan-out dedup", () => {
  it("only fans out to users without a pre-existing LOT_HOT for this lot", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    // B4: both users have a saved search matching "Big lot"
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
      { userId: "user-2", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    alertFindMany.mockResolvedValue([{ userId: "user-1" }]); // user-1 already has one
    userFindMany.mockResolvedValueOnce([
      { id: "user-2", discordWebhookUrl: "https://discord.com/api/webhooks/2/abc" },
    ]); // fan-out only for user-2
    alertCreateMany.mockResolvedValue({ count: 1 });

    await evaluateLotAfterOcr("ebay-1");

    // wait a microtask for the void-prefixed fanout
    await new Promise((r) => setTimeout(r, 10));

    expect(postToDiscord).toHaveBeenCalledOnce();
    expect(postToDiscord.mock.calls[0][0]).toBe(
      "https://discord.com/api/webhooks/2/abc"
    );
  });

  it("doesn't fire when no SavedLotSearch matches this lot (B4 opt-in)", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    savedLotSearchFindMany.mockResolvedValue([]); // no saves anywhere
    const result = await evaluateLotAfterOcr("ebay-1");
    expect(result.qualified).toBe(true);
    expect(result.alertsCreated).toBe(0);
    expect(alertCreateMany).not.toHaveBeenCalled();
  });

  it("skips Discord fan-out when the user hasn't configured a webhook URL", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    userFindMany.mockResolvedValueOnce([
      { id: "user-1", discordWebhookUrl: null },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });

    await evaluateLotAfterOcr("ebay-1");
    await new Promise((r) => setTimeout(r, 10));

    expect(postToDiscord).not.toHaveBeenCalled();
  });
});

describe("evaluateLotAfterOcr — cg5 bulk-rarity in the Discord embed", () => {
  it("includes an 'Unidentified bulk' field when bulkCounts has cards", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    userFindMany.mockResolvedValueOnce([
      { id: "user-1", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });

    await evaluateLotAfterOcr("ebay-1", {
      commons: 10,
      uncommons: 5,
      rares: 0,
      holos: 0,
    });
    await new Promise((r) => setTimeout(r, 10));

    expect(postToDiscord).toHaveBeenCalledOnce();
    const payload = postToDiscord.mock.calls[0][1] as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const field = payload.embeds[0].fields.find((f) => f.name === "Unidentified bulk");
    expect(field).toBeDefined();
    expect(field?.value).toContain("15 unidentified");
  });

  it("omits the bulk field when bulkCounts is omitted", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    userFindMany.mockResolvedValueOnce([
      { id: "user-1", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });

    await evaluateLotAfterOcr("ebay-1");
    await new Promise((r) => setTimeout(r, 10));

    const payload = postToDiscord.mock.calls[0][1] as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    expect(payload.embeds[0].fields.some((f) => f.name === "Unidentified bulk")).toBe(false);
  });

  it("omits the bulk field when every bucket is 0", async () => {
    lotFindUnique.mockResolvedValue(lotFixture());
    savedLotSearchFindMany.mockResolvedValue([
      { userId: "user-1", query: "big", minLowEstimate: null, maxAskingPrice: null },
    ]);
    userFindMany.mockResolvedValueOnce([
      { id: "user-1", discordWebhookUrl: "https://discord.com/api/webhooks/1/abc" },
    ]);
    alertCreateMany.mockResolvedValue({ count: 1 });

    await evaluateLotAfterOcr("ebay-1", {
      commons: 0,
      uncommons: 0,
      rares: 0,
      holos: 0,
    });
    await new Promise((r) => setTimeout(r, 10));

    const payload = postToDiscord.mock.calls[0][1] as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    expect(payload.embeds[0].fields.some((f) => f.name === "Unidentified bulk")).toBe(false);
  });
});
