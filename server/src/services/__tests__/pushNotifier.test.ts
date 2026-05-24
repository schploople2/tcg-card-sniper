import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

/**
 * B2 (rcs) — pushNotifier behavior.
 *
 * The push fan-out is best-effort: dead subscriptions (404/410) get
 * dropped, transient errors are logged but the row is preserved, and a
 * missing VAPID config makes the service a no-op without throwing.
 */

const {
  pushSubFindMany,
  pushSubDeleteMany,
  sendNotification,
  setVapidDetails,
} = vi.hoisted(() => ({
  pushSubFindMany: vi.fn(),
  pushSubDeleteMany: vi.fn(),
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("../../db.js", () => ({
  prisma: {
    pushSubscription: {
      findMany: pushSubFindMany,
      deleteMany: pushSubDeleteMany,
    },
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails,
    sendNotification,
  },
}));

interface MutableConfig {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT: string;
}
const configState: MutableConfig = {
  VAPID_PUBLIC_KEY: "pub",
  VAPID_PRIVATE_KEY: "priv",
  VAPID_SUBJECT: "mailto:test@example.com",
};
vi.mock("../../config.js", () => ({
  get config() {
    return configState;
  },
}));

let sendPushToUser: typeof import("../pushNotifier.js").sendPushToUser;
let buildListingPushPayload: typeof import("../pushNotifier.js").buildListingPushPayload;
let buildLotPushPayload: typeof import("../pushNotifier.js").buildLotPushPayload;

beforeAll(async () => {
  ({
    sendPushToUser,
    buildListingPushPayload,
    buildLotPushPayload,
  } = await import("../pushNotifier.js"));
});

beforeEach(() => {
  pushSubFindMany.mockReset();
  pushSubDeleteMany.mockReset();
  sendNotification.mockReset();
  setVapidDetails.mockReset();
  configState.VAPID_PUBLIC_KEY = "pub";
  configState.VAPID_PRIVATE_KEY = "priv";
  pushSubFindMany.mockResolvedValue([]);
  pushSubDeleteMany.mockResolvedValue({ count: 0 });
  sendNotification.mockResolvedValue(undefined);
});

describe("sendPushToUser", () => {
  it("returns 0 when VAPID config is missing", async () => {
    configState.VAPID_PUBLIC_KEY = undefined;
    const n = await sendPushToUser("user-1", {
      title: "t",
      body: "b",
      url: "https://x",
    });
    expect(n).toBe(0);
    expect(pushSubFindMany).not.toHaveBeenCalled();
  });

  it("returns 0 when the user has no subscriptions", async () => {
    pushSubFindMany.mockResolvedValueOnce([]);
    const n = await sendPushToUser("user-1", {
      title: "t",
      body: "b",
      url: "https://x",
    });
    expect(n).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("delivers to every active subscription for the user", async () => {
    pushSubFindMany.mockResolvedValueOnce([
      { id: "s1", endpoint: "https://e1", p256dh: "p1", auth: "a1" },
      { id: "s2", endpoint: "https://e2", p256dh: "p2", auth: "a2" },
    ]);
    const n = await sendPushToUser("user-1", {
      title: "t",
      body: "b",
      url: "https://x",
    });
    expect(n).toBe(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it("deletes subscriptions that come back 410 (gone)", async () => {
    pushSubFindMany.mockResolvedValueOnce([
      { id: "s-dead", endpoint: "https://e1", p256dh: "p", auth: "a" },
      { id: "s-live", endpoint: "https://e2", p256dh: "p", auth: "a" },
    ]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendNotification
      .mockRejectedValueOnce({ statusCode: 410, message: "Gone" })
      .mockResolvedValueOnce(undefined);

    const n = await sendPushToUser("user-1", {
      title: "t",
      body: "b",
      url: "https://x",
    });
    errSpy.mockRestore();

    expect(n).toBe(1);
    expect(pushSubDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["s-dead"] } },
    });
  });

  it("preserves subscriptions on transient errors (e.g. 500)", async () => {
    pushSubFindMany.mockResolvedValueOnce([
      { id: "s-flaky", endpoint: "https://e", p256dh: "p", auth: "a" },
    ]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    sendNotification.mockRejectedValueOnce({ statusCode: 500, message: "down" });

    const n = await sendPushToUser("user-1", {
      title: "t",
      body: "b",
      url: "https://x",
    });
    errSpy.mockRestore();

    expect(n).toBe(0);
    expect(pushSubDeleteMany).not.toHaveBeenCalled();
  });
});

describe("buildListingPushPayload", () => {
  it("includes discount percentage when marketPrice is set", () => {
    const p = buildListingPushPayload("HOT_DEAL", "Charizard ex", {
      title: "Charizard ex 199/197 NM",
      ebayUrl: "https://ebay.com/itm/123",
      totalCost: 50,
      marketPrice: 100,
    });
    expect(p.title).toContain("Charizard ex");
    expect(p.body).toContain("50% off");
    expect(p.url).toBe("https://ebay.com/itm/123");
    expect(p.tag).toContain("HOT_DEAL");
  });

  it("omits discount when marketPrice is null", () => {
    const p = buildListingPushPayload("TARGET_HIT", "Mew ex", {
      title: "Mew ex full art",
      ebayUrl: "https://ebay.com/itm/x",
      totalCost: 30,
      marketPrice: null,
    });
    expect(p.body).not.toContain("% off");
    expect(p.body).toContain("$30.00");
  });
});

describe("buildLotPushPayload", () => {
  it("renders LOT_HOT with multiple-of-value framing", () => {
    const p = buildLotPushPayload("LOT_HOT", {
      title: "Pokemon Vmax Lot",
      ebayItemId: "v1|123|0",
      listingPrice: 25,
      lowEstimate: 100,
    });
    expect(p.body).toContain("4.0× value");
    expect(p.url).toBe("https://www.ebay.com/itm/123");
  });

  it("renders MISTITLED with hidden-value framing", () => {
    const p = buildLotPushPayload(
      "MISTITLED",
      {
        title: "100 card lot",
        ebayItemId: "v1|456|0",
        listingPrice: 20,
      },
      { hiddenUsd: 250 }
    );
    expect(p.body).toContain("$250+ hidden value");
  });
});
