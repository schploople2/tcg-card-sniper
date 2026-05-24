# B2 — Web push notifications

**Bead:** `tcg-card-sniper-dev-rcs` · **Theme:** B (Delivery channels)
**Status:** ✅ shipped & verified
**Migration:** `20260524203735_push_subscription`

## What it does

Adds a third notification channel alongside the in-app bell and Discord
embed: a Web Push notification delivered straight to the user's
browser / installed PWA. All five `AlertKind`s fire push:

- 🎯 `TARGET_HIT`
- 🔥 `HOT_DEAL`
- 💎 `LOT_HOT`
- 🕵️ `MISTITLED`
- 👤 `SELLER_LISTING`

Click → opens the eBay listing URL directly (one-tap to the buying
action). Same tag replaces the previous notification rather than
stacking, so a refresh that hits the same listing twice doesn't spam
the tray.

## User flow

1. `/settings` → "Push notifications" section.
2. Click **Enable push notifications** → browser permission prompt.
3. After permission grant, a `PushSubscription` row is created on the
   server tied to this device.
4. Future alerts fan out push alongside Discord + bell.
5. **Disable** removes the row and unsubscribes the browser.

A user can subscribe from multiple devices — each device gets its own
row keyed by the push service endpoint.

## Architecture

```
Alert created (any of 5 kinds)
   │
   ├── In-app bell (existing)
   ├── Discord embed   (B1, existing)  ──► postToDiscord(user.webhookUrl, ...)
   └── Web Push        (B2, new)       ──► sendPushToUser(userId, payload)
                                              │
                                              ├── prisma.pushSubscription.findMany({userId})
                                              ├── web-push.sendNotification per row
                                              └── DELETE rows on 404/410 (dead endpoints)
```

## Schema

```sql
-- 20260524203735_push_subscription/migration.sql
CREATE TABLE "PushSubscription" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "endpoint"  TEXT NOT NULL,    -- unique per browser/device
  "p256dh"    TEXT NOT NULL,
  "auth"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/push/vapid-public-key` | — | `{publicKey: string \| null}` (null = disabled on server) |
| POST | `/api/push/subscribe` | `{endpoint, keys: {p256dh, auth}}` | `{ok, id}` |
| DELETE | `/api/push/subscribe` | `{endpoint}` | `{deleted: number}` |

## Required Railway env

| Variable | Notes |
|---|---|
| `VAPID_PUBLIC_KEY` | Generated via `web-push.generateVAPIDKeys()` |
| `VAPID_PRIVATE_KEY` | Same |
| `VAPID_SUBJECT` | `mailto:owner@example.com` — shown in some browser prompts |

If any of those three is missing, the entire push pipeline is a
no-op — `getVapidPublicKey()` returns `null`, the Settings UI surfaces
"AI suggestions aren't enabled on this server yet" (toast on subscribe
attempt), and `sendPushToUser` returns 0 without crashing.

## Files

- [prisma/schema.prisma](../../prisma/schema.prisma) — `PushSubscription` model + `User.pushSubscriptions`
- [prisma/migrations/20260524203735_push_subscription/migration.sql](../../prisma/migrations/20260524203735_push_subscription/migration.sql)
- [server/src/services/pushNotifier.ts](../../server/src/services/pushNotifier.ts) — VAPID setup, `sendPushToUser`, payload builders
- [server/src/routes/push.ts](../../server/src/routes/push.ts) — VAPID key + subscribe/unsubscribe routes
- [server/src/services/alerts.ts](../../server/src/services/alerts.ts) — `fanOutPushForListings` for TARGET_HIT, HOT_DEAL, SELLER_LISTING
- [server/src/services/lotAlerts.ts](../../server/src/services/lotAlerts.ts) — `fanOutPushLotHot`, `fanOutPushMistitled`
- [server/src/services/__tests__/pushNotifier.test.ts](../../server/src/services/__tests__/pushNotifier.test.ts) — 9 tests
- [client/public/manifest.webmanifest](../../client/public/manifest.webmanifest) — PWA manifest
- [client/public/sw.js](../../client/public/sw.js) — service worker (push + notificationclick handlers)
- [client/src/hooks/usePushSubscription.ts](../../client/src/hooks/usePushSubscription.ts) — browser-side lifecycle
- [client/src/pages/Settings.tsx](../../client/src/pages/Settings.tsx) — `PushSection`
- [client/index.html](../../client/index.html) — manifest link + theme-color

## Verification checklist

- [x] Server build clean (TypeScript strict)
- [x] `pnpm --filter server test` → 265/265 passing (9 new)
- [x] Client build clean + 8/8 tests pass
- [x] Migration applies on prod (PushSubscription table + indexes + FK)
- [x] VAPID env vars set on Railway server service
- [ ] Hands-on: enable push in Settings on desktop Chrome → see browser
      permission prompt → "Subscribed on this device" rendered → DB row
      appears in PushSubscription table
- [ ] Hands-on: trigger a HOT_DEAL via existing refresh cron → system
      notification fires → click → eBay listing opens in browser tab

## Known limitations / future work

- Per-user / per-kind toggles (e.g. "only push HOT_DEAL, not MISTITLED").
- iOS Safari: requires the user to "Add to Home Screen" first
  (Web Push only works for installed PWAs on iOS 16.4+). Behavior
  already correct — the hook reports `"unsupported"` in stock Safari
  and `"default"` once installed.
- No retry queue for transient (non-410) failures — push is best-effort.
  A separate background queue could re-attempt with backoff but adds
  significant infra complexity for marginal value.
- VAPID keys are static — there's no rotation. If the private key leaks,
  the recovery is: rotate the env var (subscriptions don't break, but new
  ones use the new key) and over time the old subscriptions drop out as
  devices re-subscribe.
