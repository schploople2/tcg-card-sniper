import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

/**
 * Pc — ocrUsage unit tests.
 *
 * Covers the per-user, per-day OCR spend ledger:
 *   - utcDayStart truncation
 *   - getTodayUsage returns zeroed defaults when no row exists
 *   - getTodayUsage hydrates from a stored row + reports remaining
 *   - isUserCapped flips at the boundary
 *   - recordOcrCall floors negatives and zeroes, bumps callsMade unconditionally
 *   - listTodayUsage exposes today's roster
 */

const findUnique = vi.fn();
const upsert = vi.fn();
const findMany = vi.fn();

vi.mock("../../db.js", () => ({
  prisma: {
    ocrUsage: { findUnique, upsert, findMany },
  },
}));

const configState = { OCR_DAILY_IMAGES_PER_USER: 100 };
vi.mock("../../config.js", () => ({
  config: configState,
}));

let utcDayStart: typeof import("../ocrUsage.js").utcDayStart;
let getTodayUsage: typeof import("../ocrUsage.js").getTodayUsage;
let isUserCapped: typeof import("../ocrUsage.js").isUserCapped;
let recordOcrCall: typeof import("../ocrUsage.js").recordOcrCall;
let listTodayUsage: typeof import("../ocrUsage.js").listTodayUsage;

beforeAll(async () => {
  ({
    utcDayStart,
    getTodayUsage,
    isUserCapped,
    recordOcrCall,
    listTodayUsage,
  } = await import("../ocrUsage.js"));
});

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
  findMany.mockReset();
  configState.OCR_DAILY_IMAGES_PER_USER = 100;
});

describe("utcDayStart", () => {
  it("truncates to UTC midnight", () => {
    const day = utcDayStart(new Date("2026-05-23T17:43:21.123Z"));
    expect(day.toISOString()).toBe("2026-05-23T00:00:00.000Z");
  });

  it("doesn't drift on UTC date rollover", () => {
    // 2026-05-23 23:59:59 UTC → 2026-05-23 (not 24th)
    const day = utcDayStart(new Date("2026-05-23T23:59:59Z"));
    expect(day.toISOString()).toBe("2026-05-23T00:00:00.000Z");
  });
});

describe("getTodayUsage", () => {
  it("returns zeroed status when no row exists", async () => {
    findUnique.mockResolvedValueOnce(null);
    const status = await getTodayUsage("user-1");
    expect(status.imagesProcessed).toBe(0);
    expect(status.callsMade).toBe(0);
    expect(status.cap).toBe(100);
    expect(status.remaining).toBe(100);
  });

  it("hydrates from a stored row and computes remaining", async () => {
    findUnique.mockResolvedValueOnce({ imagesProcessed: 73, callsMade: 12 });
    const status = await getTodayUsage("user-1");
    expect(status.imagesProcessed).toBe(73);
    expect(status.callsMade).toBe(12);
    expect(status.remaining).toBe(27);
  });

  it("clamps remaining to 0 when usage exceeds cap (e.g. cap was lowered)", async () => {
    findUnique.mockResolvedValueOnce({ imagesProcessed: 150, callsMade: 20 });
    const status = await getTodayUsage("user-1");
    expect(status.remaining).toBe(0);
  });

  it("queries by composite (userId, day) unique key", async () => {
    findUnique.mockResolvedValueOnce(null);
    await getTodayUsage("user-42");
    const call = findUnique.mock.calls[0][0];
    expect(call.where.userId_day.userId).toBe("user-42");
    expect(call.where.userId_day.day).toBeInstanceOf(Date);
  });
});

describe("isUserCapped", () => {
  it("false when below cap", async () => {
    findUnique.mockResolvedValueOnce({ imagesProcessed: 99, callsMade: 1 });
    expect(await isUserCapped("u")).toBe(false);
  });

  it("true at the boundary", async () => {
    findUnique.mockResolvedValueOnce({ imagesProcessed: 100, callsMade: 5 });
    expect(await isUserCapped("u")).toBe(true);
  });

  it("true when over the cap", async () => {
    findUnique.mockResolvedValueOnce({ imagesProcessed: 200, callsMade: 5 });
    expect(await isUserCapped("u")).toBe(true);
  });

  it("false with no row at all", async () => {
    findUnique.mockResolvedValueOnce(null);
    expect(await isUserCapped("u")).toBe(false);
  });
});

describe("recordOcrCall", () => {
  it("upserts with the correct increments on cache-miss (>0 images)", async () => {
    upsert.mockResolvedValueOnce({ imagesProcessed: 4, callsMade: 1 });
    const status = await recordOcrCall("user-1", 4);
    expect(status.imagesProcessed).toBe(4);
    expect(status.callsMade).toBe(1);
    expect(status.remaining).toBe(96);
    const { create, update, where } = upsert.mock.calls[0][0];
    expect(where.userId_day.userId).toBe("user-1");
    expect(create.imagesProcessed).toBe(4);
    expect(create.callsMade).toBe(1);
    expect(update.imagesProcessed).toEqual({ increment: 4 });
    expect(update.callsMade).toEqual({ increment: 1 });
  });

  it("still bumps callsMade when imagesProcessed=0 (pure cache hit)", async () => {
    upsert.mockResolvedValueOnce({ imagesProcessed: 0, callsMade: 1 });
    await recordOcrCall("user-1", 0);
    const { create, update } = upsert.mock.calls[0][0];
    expect(create.imagesProcessed).toBe(0);
    expect(create.callsMade).toBe(1);
    expect(update.callsMade).toEqual({ increment: 1 });
  });

  it("floors fractional and clamps negative imagesProcessed to 0", async () => {
    upsert.mockResolvedValueOnce({ imagesProcessed: 3, callsMade: 1 });
    await recordOcrCall("user-1", 3.9);
    expect(upsert.mock.calls[0][0].create.imagesProcessed).toBe(3);

    upsert.mockResolvedValueOnce({ imagesProcessed: 0, callsMade: 1 });
    await recordOcrCall("user-1", -5);
    expect(upsert.mock.calls[1][0].create.imagesProcessed).toBe(0);
  });
});

describe("listTodayUsage", () => {
  it("flattens user email into the response row and preserves order", async () => {
    findMany.mockResolvedValueOnce([
      {
        userId: "u-2",
        imagesProcessed: 80,
        callsMade: 4,
        user: { email: "heavy@example.com" },
      },
      {
        userId: "u-1",
        imagesProcessed: 5,
        callsMade: 2,
        user: { email: "light@example.com" },
      },
    ]);
    const rows = await listTodayUsage();
    expect(rows).toEqual([
      { userId: "u-2", email: "heavy@example.com", imagesProcessed: 80, callsMade: 4 },
      { userId: "u-1", email: "light@example.com", imagesProcessed: 5, callsMade: 2 },
    ]);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ imagesProcessed: "desc" });
  });

  it("returns an empty array when no one has used OCR today", async () => {
    findMany.mockResolvedValueOnce([]);
    expect(await listTodayUsage()).toEqual([]);
  });
});
