/* TCG Card Sniper service worker — handles Web Push (B2). */
/* eslint-disable no-restricted-globals */

self.addEventListener("install", () => {
  // Activate the new SW immediately on first install — there's no v1 cache
  // to drain, and the alert-delivery path benefits from the freshest code.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Server posts a JSON body shaped as { title, body, url, tag? } — see
 * server/src/services/pushNotifier.ts `PushPayload`. We parse defensively
 * because the spec allows raw text payloads too.
 */
self.addEventListener("push", (event) => {
  let payload = { title: "TCG Card Sniper", body: "", url: "/", tag: undefined };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      // Stash the click URL on the notification itself; notificationclick reads it back.
      data: { url: payload.url },
      icon: "/favicon.svg",
      badge: "/favicon.svg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || "/";
  event.waitUntil(
    (async () => {
      // If a tab is already on the same URL, focus it instead of opening
      // a duplicate. eBay listing URLs in particular benefit from this —
      // the user likely already has the listing open.
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of all) {
        if (c.url === url && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })()
  );
});
