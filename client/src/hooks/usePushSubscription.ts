import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * B2 — Web Push subscription lifecycle.
 *
 * State machine:
 *   "unsupported"   browser lacks SW or Push API (e.g. Safari < 16, in-app browsers)
 *   "denied"        user permanently blocked notifications for this origin
 *   "default"       never asked or dismissed — we can prompt via subscribe()
 *   "subscribed"    we have a live PushSubscription on this device
 *   "loading"       initial probe in progress
 *
 * subscribe() requests permission + creates a browser PushSubscription +
 * POSTs it to the server. unsubscribe() reverses both sides.
 */

type PushStatus =
  | "loading"
  | "unsupported"
  | "denied"
  | "default"
  | "subscribed";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Explicit ArrayBuffer (not SharedArrayBuffer) backing — PushManager's
  // applicationServerKey rejects the union type otherwise under strict tsc.
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  return navigator.serviceWorker.register("/sw.js");
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);

  // Probe on mount: register SW (idempotent) and check current subscription.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      try {
        const reg = await getRegistration();
        if (!reg) {
          if (!cancelled) setStatus("unsupported");
          return;
        }
        const existing = await reg.pushManager.getSubscription();
        if (cancelled) return;
        setStatus(existing ? "subscribed" : "default");
      } catch (err) {
        console.error("[push] probe failed:", err);
        if (!cancelled) setStatus("unsupported");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(async () => {
    if (status === "unsupported" || status === "denied") return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "default");
        if (perm === "denied") {
          toast.error("Notifications blocked. Enable them in your browser settings.");
        }
        return;
      }

      const { data: keyData } = await api.get<{ publicKey: string | null }>(
        "/api/push/vapid-public-key"
      );
      if (!keyData.publicKey) {
        toast.error("Push notifications aren't enabled on this server yet.");
        return;
      }

      const reg = await getRegistration();
      if (!reg) {
        setStatus("unsupported");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(keyData.publicKey),
      });
      const json = sub.toJSON();
      await api.post("/api/push/subscribe", {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setStatus("subscribed");
      toast.success("Push notifications enabled");
    } catch (err) {
      console.error("[push] subscribe failed:", err);
      toast.error("Failed to enable push notifications");
    } finally {
      setBusy(false);
    }
  }, [status]);

  const unsubscribe = useCallback(async () => {
    setBusy(true);
    try {
      const reg = await getRegistration();
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus("default");
        return;
      }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      // Best-effort server cleanup — even if this fails, the browser side
      // is already off, so future pushes will 410 and the server will drop
      // the row.
      await api
        .delete("/api/push/subscribe", { data: { endpoint } })
        .catch(() => undefined);
      setStatus("default");
      toast.success("Push notifications disabled");
    } catch (err) {
      console.error("[push] unsubscribe failed:", err);
      toast.error("Failed to disable push notifications");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, subscribe, unsubscribe };
}
