import { prisma } from "../db.js";
import { config } from "../config.js";

/**
 * Per-user, per-day OCR spend ledger.
 *
 * - `imagesProcessed` counts only API-billed images (cache hits don't add).
 * - `callsMade` counts /ocr-suggestions invocations regardless of cache status.
 * - The soft cap (`OCR_DAILY_IMAGES_PER_USER`) is checked against
 *   `imagesProcessed` so re-running cached lots is always free.
 *
 * "Day" is UTC midnight of the call's wall-clock day. Truncation happens here,
 * not in SQL, so the result is independent of database time-zone settings.
 */

export interface OcrUsageStatus {
  /** UTC day this row aggregates (midnight). */
  day: Date;
  imagesProcessed: number;
  callsMade: number;
  /** Configured cap from `OCR_DAILY_IMAGES_PER_USER`. */
  cap: number;
  /** Max(0, cap - imagesProcessed). */
  remaining: number;
}

/** UTC midnight for the given timestamp (default = now). */
export function utcDayStart(at: Date = new Date()): Date {
  return new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
  );
}

/**
 * Get today's usage row for `userId`. Returns a zeroed status when no row
 * exists yet (no DB write — the row materialises on first increment).
 */
export async function getTodayUsage(userId: string): Promise<OcrUsageStatus> {
  const day = utcDayStart();
  const row = await prisma.ocrUsage.findUnique({
    where: { userId_day: { userId, day } },
  });
  const cap = config.OCR_DAILY_IMAGES_PER_USER;
  const imagesProcessed = row?.imagesProcessed ?? 0;
  const callsMade = row?.callsMade ?? 0;
  return {
    day,
    imagesProcessed,
    callsMade,
    cap,
    remaining: Math.max(0, cap - imagesProcessed),
  };
}

/**
 * True when the user has already crossed the daily cap. Cache-only re-runs
 * stay allowed because they don't add to `imagesProcessed`.
 */
export async function isUserCapped(userId: string): Promise<boolean> {
  const { imagesProcessed, cap } = await getTodayUsage(userId);
  return imagesProcessed >= cap;
}

/**
 * Atomically increment today's ledger. Always bumps `callsMade` by 1; bumps
 * `imagesProcessed` by `imagesProcessed` (may be 0 on a pure cache hit, in
 * which case `callsMade` still goes up — useful for spotting interest).
 */
export async function recordOcrCall(
  userId: string,
  imagesProcessed: number
): Promise<OcrUsageStatus> {
  const day = utcDayStart();
  const safeImages = Math.max(0, Math.floor(imagesProcessed));
  const row = await prisma.ocrUsage.upsert({
    where: { userId_day: { userId, day } },
    create: {
      userId,
      day,
      imagesProcessed: safeImages,
      callsMade: 1,
    },
    update: {
      imagesProcessed: { increment: safeImages },
      callsMade: { increment: 1 },
    },
  });
  const cap = config.OCR_DAILY_IMAGES_PER_USER;
  return {
    day,
    imagesProcessed: row.imagesProcessed,
    callsMade: row.callsMade,
    cap,
    remaining: Math.max(0, cap - row.imagesProcessed),
  };
}

/** Today's per-user ledger across all users (admin view). */
export async function listTodayUsage(): Promise<
  Array<{
    userId: string;
    email: string;
    imagesProcessed: number;
    callsMade: number;
  }>
> {
  const day = utcDayStart();
  const rows = await prisma.ocrUsage.findMany({
    where: { day },
    orderBy: { imagesProcessed: "desc" },
    include: { user: { select: { email: true } } },
  });
  return rows.map((r) => ({
    userId: r.userId,
    email: r.user.email,
    imagesProcessed: r.imagesProcessed,
    callsMade: r.callsMade,
  }));
}
