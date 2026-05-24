import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildAlertEmbed,
  buildTestEmbed,
  isValidDiscordWebhookUrl,
  postToDiscord,
  redactWebhookUrl,
} from "../discordNotifier.js";
import { AlertKind } from "@prisma/client";

/**
 * 8cr (B1) — discordNotifier helpers + POST behavior.
 *
 * Mocks global fetch to assert POST shape, embed structure, error
 * handling, and timeout. Doesn't actually hit Discord.
 */

describe("isValidDiscordWebhookUrl", () => {
  it("accepts canonical Discord webhook URLs", () => {
    expect(
      isValidDiscordWebhookUrl(
        "https://discord.com/api/webhooks/1234567890/abc-DEF_123"
      )
    ).toBe(true);
    expect(
      isValidDiscordWebhookUrl(
        "https://discordapp.com/api/webhooks/1/abcDEF"
      )
    ).toBe(true);
    expect(
      isValidDiscordWebhookUrl(
        "https://ptb.discord.com/api/webhooks/1/abc"
      )
    ).toBe(true);
  });

  it("rejects obvious mistakes", () => {
    expect(isValidDiscordWebhookUrl("")).toBe(false);
    expect(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/1/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://slack.com/api/webhooks/1/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://discord.com/api/webhooks//")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://discord.com/oauth2/authorize")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(
      isValidDiscordWebhookUrl(
        "   https://discord.com/api/webhooks/1234567890/abcDEF   "
      )
    ).toBe(true);
  });
});

describe("redactWebhookUrl", () => {
  it("returns null when no URL set", () => {
    expect(redactWebhookUrl(null)).toBeNull();
  });

  it("shows only the last 10 characters", () => {
    expect(
      redactWebhookUrl(
        "https://discord.com/api/webhooks/1234567890/abcDEFghij"
      )
    ).toBe("…abcDEFghij");
  });
});

describe("buildAlertEmbed", () => {
  const base = {
    kind: AlertKind.HOT_DEAL,
    cardName: "Charizard",
    variant: "holofoil",
    listingTitle: "Charizard Base Set Holo",
    listingUrl: "https://ebay.com/itm/123",
    imageUrl: "https://ebay.com/img/123.jpg",
    totalCost: 50,
    marketPrice: 100,
    condition: "NM",
    dealTier: "HOT",
  };

  it("uses the tier color for HOT", () => {
    const body = buildAlertEmbed(base) as { embeds: Array<{ color: number }> };
    expect(body.embeds[0].color).toBe(0xff5722);
  });

  it("falls back to UNSCORED color when tier is unknown", () => {
    const body = buildAlertEmbed({ ...base, dealTier: "BOGUS" }) as {
      embeds: Array<{ color: number }>;
    };
    expect(body.embeds[0].color).toBe(0x607d8b);
  });

  it("includes Price / Market / Savings fields when marketPrice is set", () => {
    const body = buildAlertEmbed(base) as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const names = body.embeds[0].fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["Price", "Market", "Savings"]));
    const savings = body.embeds[0].fields.find((f) => f.name === "Savings");
    expect(savings?.value).toBe("+50%");
  });

  it("omits Market / Savings when marketPrice is null (UNSCORED)", () => {
    const body = buildAlertEmbed({ ...base, marketPrice: null }) as {
      embeds: Array<{ fields: Array<{ name: string }> }>;
    };
    const names = body.embeds[0].fields.map((f) => f.name);
    expect(names).toContain("Price");
    expect(names).not.toContain("Savings");
  });

  it("truncates the listing title to Discord's 256-char cap", () => {
    const long = "x".repeat(300);
    const body = buildAlertEmbed({ ...base, listingTitle: long }) as {
      embeds: Array<{ title: string }>;
    };
    expect(body.embeds[0].title.length).toBe(256);
  });

  it("labels TARGET_HIT vs HOT_DEAL in the description", () => {
    const hot = buildAlertEmbed(base) as { embeds: Array<{ description: string }> };
    const target = buildAlertEmbed({ ...base, kind: AlertKind.TARGET_HIT }) as {
      embeds: Array<{ description: string }>;
    };
    expect(hot.embeds[0].description).toContain("Hot deal");
    expect(target.embeds[0].description).toContain("Target");
  });
});

describe("postToDiscord", () => {
  const url = "https://discord.com/api/webhooks/1234567890/abcDEFghij";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { ok: false } for an invalid URL without firing a request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await postToDiscord("not-a-url", {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns { ok: true } when Discord responds 204", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    );
    const result = await postToDiscord(url, { content: "hi" });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
  });

  it("returns { ok: false, status } and includes Discord's error text on 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
      })
    );
    const result = await postToDiscord(url, {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("rate limited");
  });

  it("returns { error: 'timeout' } when the request aborts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    vi.useFakeTimers();
    const p = postToDiscord(url, {});
    await vi.advanceTimersByTimeAsync(6000);
    const result = await p;
    vi.useRealTimers();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("posts the payload as JSON with the right content-type", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    );
    await postToDiscord(url, { content: "x" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [reqUrl, init] = fetchSpy.mock.calls[0];
    expect(reqUrl).toBe(url);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(init?.body).toBe(JSON.stringify({ content: "x" }));
  });
});

describe("buildTestEmbed", () => {
  it("returns a recognizable green test message", () => {
    const body = buildTestEmbed() as {
      embeds: Array<{ title: string; color: number }>;
    };
    expect(body.embeds[0].title).toContain("Test alert");
    expect(body.embeds[0].color).toBe(0x4caf50);
  });
});
