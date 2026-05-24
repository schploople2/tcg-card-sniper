-- Add Discord webhook URL to User for B1 alert fan-out.
-- Null means user has not opted in. Stored plaintext at user trust level
-- (same as email/password hash); GETs from /api/settings redact it.
ALTER TABLE "User" ADD COLUMN "discordWebhookUrl" TEXT;
