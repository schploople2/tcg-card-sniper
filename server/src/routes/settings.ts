import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { AppError } from "../middleware/errorHandler.js";
import {
  buildTestEmbed,
  isValidDiscordWebhookUrl,
  postToDiscord,
  redactWebhookUrl,
} from "../services/discordNotifier.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

/**
 * Settings endpoints — user-scoped preferences. v1 holds only the Discord
 * webhook URL (B1). Future fields (push subscriptions, email-digest
 * cadence, alert thresholds) live here too.
 *
 * Authz: every endpoint scopes to req.user!.userId.
 */

const settingsUpdateSchema = z.object({
  // Accept empty string as "unset". Null also unsets. Otherwise must be
  // a recognisable Discord webhook URL — we soft-validate here so the
  // user gets a clear error before we waste a real POST.
  discordWebhookUrl: z
    .string()
    .max(500)
    .nullable()
    .optional()
    .transform((v) => (v === undefined || v === null || v === "" ? null : v.trim())),
});

/**
 * GET /api/settings
 * Returns the user's settings with the webhook URL redacted to its last
 * 10 chars (or null when unset). Never returns the full URL — that's
 * write-only after the initial save.
 */
settingsRouter.get("/", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { discordWebhookUrl: true },
    });
    if (!user) throw new AppError(404, "User not found");
    res.json({
      discordWebhookUrl: redactWebhookUrl(user.discordWebhookUrl),
      discordWebhookConfigured: !!user.discordWebhookUrl,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings
 * Body: `{ discordWebhookUrl: "https://..." | null }` to set/unset.
 * Validates URL shape before writing. Does not POST to Discord here —
 * use POST /api/settings/test-webhook for that.
 */
settingsRouter.put("/", async (req, res, next) => {
  try {
    const parsed = settingsUpdateSchema.parse(req.body);
    if (parsed.discordWebhookUrl && !isValidDiscordWebhookUrl(parsed.discordWebhookUrl)) {
      throw new AppError(
        400,
        "Discord webhook URL must look like https://discord.com/api/webhooks/<id>/<token>"
      );
    }
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { discordWebhookUrl: parsed.discordWebhookUrl },
      select: { discordWebhookUrl: true },
    });
    res.json({
      discordWebhookUrl: redactWebhookUrl(user.discordWebhookUrl),
      discordWebhookConfigured: !!user.discordWebhookUrl,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/test-webhook
 * Fires a sample embed at the user's saved webhook. Used by the
 * Settings UI to confirm the URL works before relying on it for alerts.
 * Returns the Discord HTTP status (or an error message) so the UI can
 * show a precise success / failure state.
 */
settingsRouter.post("/test-webhook", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { discordWebhookUrl: true },
    });
    if (!user?.discordWebhookUrl) {
      throw new AppError(400, "No Discord webhook URL saved. Set one first.");
    }
    const result = await postToDiscord(user.discordWebhookUrl, buildTestEmbed());
    if (!result.ok) {
      throw new AppError(
        502,
        `Discord rejected the test message: ${result.error ?? `status ${result.status}`}`
      );
    }
    res.json({ ok: true, status: result.status });
  } catch (err) {
    next(err);
  }
});
