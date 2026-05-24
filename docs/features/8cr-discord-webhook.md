# B1 — Discord webhook for alerts

**Bead:** `tcg-card-sniper-dev-8cr` · **Theme:** B · **Status:** in progress (pending live verification)
**Shipped in:** commit `c040419` · **Migration:** `20260524010000_discord_webhook_url`

## What it does

Every time the alerts pipeline creates a TARGET_HIT or HOT_DEAL row for a
user who has saved a Discord webhook URL, the alert is also POSTed as a
rich embed to that user's Discord channel. The in-app bell still works
exactly as before — Discord is an additional delivery channel, not a
replacement.

This closes the most-cited competitive gap vs PokeSnipe / Pallet /
PokeTCG Deals (Discord deal bots), which is why it scored highest by
ICE (150) in the Phase 9 roadmap.

## User flow

1. User goes to `/settings` (gear icon in the top nav).
2. Pastes a Discord webhook URL into the Webhook URL field, clicks **Save**.
3. Optional: clicks **Send test** → a green `✅ Test alert from TCG Card Sniper`
   embed lands in their Discord channel within ~1s. Used to verify the
   URL works before relying on it for real alerts.
4. Future alerts (any TARGET_HIT or HOT_DEAL) automatically appear in
   Discord with a tier-coloured embed including the card name, listing
   title (links to eBay), price, market reference, % savings, condition,
   and variant.
5. To stop receiving alerts: click **Remove** (sets the column back to NULL).
6. To replace: paste a new URL in the input and **Save** — the old URL is
   overwritten.

## How users generate a webhook URL

Step-by-step in Discord (web or desktop app):

1. Pick the Discord server + channel where alerts should land.
2. Right-click the channel name → **Edit Channel** (or click the cog icon
   next to the channel).
3. Sidebar → **Integrations** → **Webhooks** → **New Webhook**.
4. Optionally rename it ("TCG Card Sniper") and give it an avatar.
5. Click **Copy Webhook URL**. The URL looks like:
   `https://discord.com/api/webhooks/1234567890/abcDEF...`
6. Paste into `/settings` on TCG Card Sniper. Save. Test.

**Security note for users:** anyone with the URL can post to your
channel. Treat it like a password — don't share, don't paste in public
chats. The app stores it plaintext on your user row at the same trust
level as your email/password hash, and never returns the full URL in
GET responses (only the last 10 characters, e.g. `…abc1234567`).

## Architecture

```
┌────────────────────┐
│ refreshListings    │ (30-min cron)
│ cron job           │
└────────┬───────────┘
         │ calls evaluateListings(card, listings)
         ▼
┌────────────────────────────────────────┐
│ services/alerts.ts                     │
│  evaluateListings(card, listings)      │
│   1. Build candidate alerts            │
│   2. findMany existing alerts (dedup)  │
│   3. createMany (skipDuplicates)       │
│   4. void fanOutDiscord(userId, novel) │
└────────┬───────────────────────────────┘
         │ fire-and-forget
         ▼
┌────────────────────────────────────────┐
│ fanOutDiscord(userId, alerts)          │
│   findUnique user.discordWebhookUrl    │
│   if NULL → return                     │
│   findMany listings + cards            │
│   for each alert:                      │
│     buildAlertEmbed(...)               │
│     postToDiscord(url, embed) ← 5s     │
│     log on non-2xx (don't throw)       │
└────────────────────────────────────────┘
```

Companion endpoints:

- `GET  /api/settings` → `{discordWebhookUrl: redacted | null, discordWebhookConfigured: boolean}`
- `PUT  /api/settings` → body `{discordWebhookUrl: string | null}`. Zod-validated.
- `POST /api/settings/test-webhook` → fires `buildTestEmbed()` to the saved URL.

## Embed shape

`buildAlertEmbed(input)` in [server/src/services/discordNotifier.ts](../../server/src/services/discordNotifier.ts) returns the JSON Discord
expects. Each embed has:

- **Title** — listing title (truncated to Discord's 256-char cap), links to the eBay URL
- **Description** — kind label (🎯 Target price hit / 🔥 Hot deal) + card name
- **Color** — by deal tier: HOT=orange, GOOD=green, FAIR=amber, OVER=grey
- **Fields** (inline): Price, Market, Savings (%), Condition, Variant — omits any that are null
- **Thumbnail** — listing image
- **Timestamp** — alert creation time
- **Username** — "TCG Card Sniper"

## Failure behaviour

- **Discord 4xx/5xx** → logged with status + first 200 chars of response body, alert
  itself is unaffected. No retry (Discord webhook 429s exist but for v1 we drop).
- **5s timeout** → logged as `timeout`, alert unaffected.
- **Invalid webhook URL stored** → caught by regex in `postToDiscord`, returns
  `{ok: false, error: "invalid webhook URL format"}` without firing a request.
- **Server crash mid-fanout** → next alert refresh will produce new candidates;
  failed alerts ARE in the DB (createMany happens before fanout) so they show
  up in the bell, just not in Discord.

## Why no encryption at rest

Webhook URLs are sensitive (anyone with the URL can post) but they live
on the user's profile next to their `passwordHash` and `email`. Symmetric
encryption inside the same DB would add complexity without changing the
threat surface — if an attacker has DB read access they have both the
encrypted webhook AND the encryption key. Future revisit: if we ever
add per-user envelope encryption with a KMS, the webhook column comes
along for the ride.

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `User.discordWebhookUrl` column
- [prisma/migrations/20260524010000_discord_webhook_url/migration.sql](../../prisma/migrations/20260524010000_discord_webhook_url/migration.sql)
- [server/src/services/discordNotifier.ts](../../server/src/services/discordNotifier.ts) — embed builder + POST helper
- [server/src/routes/settings.ts](../../server/src/routes/settings.ts) — settings router
- [server/src/services/alerts.ts](../../server/src/services/alerts.ts) — `fanOutDiscord` + pre-check
- [server/src/services/__tests__/discordNotifier.test.ts](../../server/src/services/__tests__/discordNotifier.test.ts) — 17 unit tests
- [client/src/hooks/useSettings.ts](../../client/src/hooks/useSettings.ts) — `useSettings` / `useSaveSettings` / `useTestWebhook`
- [client/src/pages/Settings.tsx](../../client/src/pages/Settings.tsx) — `/settings` page
- [client/src/App.tsx](../../client/src/App.tsx) — route guard
- [client/src/components/layout/TopNav.tsx](../../client/src/components/layout/TopNav.tsx) — nav link

## Verification checklist

- [x] `pnpm --filter server test` → 219/219 passing (17 new in `discordNotifier.test.ts`)
- [x] `pnpm --filter client test` → 8/8 passing
- [x] Server `pnpm build` clean (TypeScript)
- [x] Client `pnpm build` clean
- [x] Migration applied on Railway prod DB on server boot
- [x] `/settings` page renders at https://poke-sniper.up.railway.app/settings
- [ ] **Hands-on test:** paste a real Discord webhook URL → Save → click Send test → confirm `✅ Test alert from TCG Card Sniper` embed appears in Discord channel ⟵ blocks close
- [ ] **End-to-end test:** trigger a HOT_DEAL or TARGET_HIT alert via the listing refresh and confirm it lands in Discord with the right embed shape ⟵ blocks close

## Future improvements (deferred to follow-up beads)

- Web push (B2) reuses the same fan-out pattern; one user could opt into Discord, push, or both.
- Per-deal-tier opt-out (e.g. "only TARGET_HIT, not HOT_DEAL") needs schema and UI; today it's all-or-nothing.
- Retry-with-backoff on Discord 429 (currently we drop and log).
- Multi-channel support (one webhook per filter / tag combo).
