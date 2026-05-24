import { useEffect, useState } from "react";
import { Send, Save, Trash2, ExternalLink, Bookmark, UserPlus, Bell, BellOff } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useSettings,
  useSaveSettings,
  useTestWebhook,
} from "@/hooks/useSettings";
import {
  useSavedLotSearches,
  useDeleteSavedLotSearch,
} from "@/hooks/useSavedLotSearches";
import {
  useWatchedSellers,
  useCreateWatchedSeller,
  useDeleteWatchedSeller,
} from "@/hooks/useWatchedSellers";
import { usePushSubscription } from "@/hooks/usePushSubscription";
import { formatDistanceToNow } from "date-fns";

/**
 * Settings page (B1 minimum: Discord webhook URL).
 *
 * Future fields (web push subscriptions, email digest cadence, alert
 * thresholds) land on this page next to the Discord field as the
 * Theme B work ships.
 */
export default function Settings() {
  const { data, isLoading } = useSettings();
  const save = useSaveSettings();
  const test = useTestWebhook();

  // Local input value. Starts blank when there's nothing saved; we never
  // pre-fill with the redacted URL (it's not a real value the user can
  // edit-and-resubmit). To clear an existing webhook the user clicks the
  // "Remove" button.
  const [draftUrl, setDraftUrl] = useState("");

  // When the saved state arrives, blank the draft — we want the form to
  // be empty unless the user is actively typing a NEW URL.
  useEffect(() => {
    setDraftUrl("");
  }, [data?.discordWebhookConfigured]);

  function handleSave() {
    const trimmed = draftUrl.trim();
    if (!trimmed) return;
    save.mutate(
      { discordWebhookUrl: trimmed },
      { onSuccess: () => setDraftUrl("") }
    );
  }

  function handleRemove() {
    save.mutate({ discordWebhookUrl: null });
  }

  const hasUrl = data?.discordWebhookConfigured ?? false;

  return (
    <PageShell>
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-slate-100">Settings</h1>
          <p className="text-sm text-slate-400 mt-1">
            Configure how the sniper reaches you when a deal lands.
          </p>
        </header>

        {/* Discord webhook card */}
        <section className="rounded-xl border border-slate-800 bg-[#0a0f1e]/60 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Discord webhook
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-prose">
                Every target-price hit and HOT deal gets posted as a Discord
                embed in addition to the in-app bell.{" "}
                <a
                  href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks"
                  target="_blank"
                  rel="noreferrer"
                  className="text-purple-300 hover:text-purple-200 inline-flex items-center gap-0.5"
                >
                  How to create one
                  <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="h-20 rounded bg-slate-900/50 animate-pulse" />
          ) : (
            <>
              {hasUrl && (
                <div className="mb-3 flex items-center justify-between rounded-md border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-xs">
                  <span className="text-emerald-300">
                    Webhook saved — last 10 chars:{" "}
                    <span className="font-mono">
                      {data?.discordWebhookUrl}
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => test.mutate()}
                      disabled={test.isPending}
                      className="h-7 text-xs"
                    >
                      <Send className="h-3 w-3 mr-1" />
                      {test.isPending ? "Sending…" : "Send test"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleRemove}
                      disabled={save.isPending}
                      className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Remove
                    </Button>
                  </div>
                </div>
              )}

              <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
                {hasUrl ? "Replace with a new URL" : "Webhook URL"}
              </label>
              <div className="flex gap-2">
                <Input
                  type="url"
                  value={draftUrl}
                  onChange={(e) => setDraftUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/…"
                  className="flex-1 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  onClick={handleSave}
                  disabled={!draftUrl.trim() || save.isPending}
                  className="bg-yellow-500 text-slate-950 hover:bg-yellow-400"
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  Save
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-slate-600">
                The URL is stored on your account and never displayed in full
                after saving. Anyone with it can post to your channel — treat
                it like a password.
              </p>
            </>
          )}
        </section>

        {/* B2 — Web push notifications */}
        <PushSection />

        {/* B4 — Saved lot searches */}
        <SavedSearchesSection />

        {/* D2 — Watched sellers */}
        <WatchedSellersSection />
      </div>
    </PageShell>
  );
}

function WatchedSellersSection() {
  const { data, isLoading } = useWatchedSellers();
  const create = useCreateWatchedSeller();
  const del = useDeleteWatchedSeller();
  const sellers = data?.watchedSellers ?? [];
  const [draftName, setDraftName] = useState("");

  function handleAdd() {
    const name = draftName.trim();
    if (!name) return;
    create.mutate(
      { sellerName: name },
      { onSuccess: () => setDraftName("") }
    );
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0a0f1e]/60 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-orange-400" />
            Watched sellers
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-prose">
            Get notified (in-app + Discord) when a specific eBay seller's
            listing shows up in your watched-card refreshes.{" "}
            <span className="text-slate-600">
              v1 limitation: alerts only fire when the seller lists a card
              you also watch — full per-seller search lands in a follow-up.
            </span>
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <Input
          type="text"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="eBay seller username (e.g. kstamps-2015)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          className="flex-1 bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-500"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          onClick={handleAdd}
          disabled={!draftName.trim() || create.isPending}
          className="bg-orange-500/80 text-slate-950 hover:bg-orange-400"
        >
          <UserPlus className="h-4 w-4 mr-1.5" />
          Watch
        </Button>
      </div>

      {isLoading ? (
        <div className="h-12 rounded bg-slate-900/50 animate-pulse" />
      ) : sellers.length === 0 ? (
        <div className="text-xs text-slate-500 italic px-1 py-2">
          No watched sellers yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {sellers.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate font-medium">
                  @{s.sellerName}
                </p>
                {s.note && (
                  <p className="text-[10px] text-slate-500 mt-0.5">{s.note}</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => del.mutate(s.id)}
                disabled={del.isPending}
                className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedSearchesSection() {
  const { data, isLoading } = useSavedLotSearches();
  const del = useDeleteSavedLotSearch();
  const searches = data?.savedSearches ?? [];

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0a0f1e]/60 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-purple-400" />
            Saved lot searches
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-prose">
            Lot alerts (💎 LOT_HOT) only fire for lots whose title matches at
            least one of your saved searches. Saves are added from the{" "}
            <a
              href="/"
              className="text-purple-300 hover:text-purple-200 underline"
            >
              Lots tab
            </a>{" "}
            — type a query and click <strong>Save</strong>.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="h-12 rounded bg-slate-900/50 animate-pulse" />
      ) : searches.length === 0 ? (
        <div className="text-xs text-slate-500 italic px-1 py-3">
          No saved searches — you won't receive any LOT_HOT alerts. Add one
          from the Lots tab to start.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {searches.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200 truncate font-medium">
                  {s.query}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {s.lastEvaluatedAt
                    ? `last checked ${formatDistanceToNow(new Date(s.lastEvaluatedAt), { addSuffix: true })}`
                    : "not yet evaluated"}
                  {s.minLowEstimate != null &&
                    ` · low ≥ $${Number(s.minLowEstimate).toFixed(0)}`}
                  {s.maxAskingPrice != null &&
                    ` · asking ≤ $${Number(s.maxAskingPrice).toFixed(0)}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => del.mutate(s.id)}
                disabled={del.isPending}
                className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PushSection() {
  const { status, busy, subscribe, unsubscribe } = usePushSubscription();

  return (
    <section className="rounded-xl border border-slate-800 bg-[#0a0f1e]/60 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Bell className="h-4 w-4 text-amber-300" /> Push notifications
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-prose">
            Get a system notification on this device the moment a HOT deal,
            target hit, hot lot, mis-titled lot, or watched-seller listing
            fires. Tapping the notification opens the eBay listing directly.
          </p>
        </div>
      </div>

      {status === "loading" && (
        <p className="text-xs text-slate-500">Checking browser support…</p>
      )}
      {status === "unsupported" && (
        <p className="text-xs text-slate-500">
          This browser does not support web push. Try a recent Chrome, Edge,
          Firefox, or Safari 16+.
        </p>
      )}
      {status === "denied" && (
        <p className="text-xs text-amber-400">
          Notifications are blocked for this site. Enable them in your
          browser settings and reload to subscribe.
        </p>
      )}
      {status === "default" && (
        <Button
          size="sm"
          onClick={subscribe}
          disabled={busy}
          className="gap-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950"
        >
          <Bell className="h-3.5 w-3.5" />
          {busy ? "Enabling…" : "Enable push notifications"}
        </Button>
      )}
      {status === "subscribed" && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-emerald-400">
            ✓ Subscribed on this device
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={unsubscribe}
            disabled={busy}
            className="gap-1.5 h-7 text-xs text-slate-400 hover:text-slate-200"
          >
            <BellOff className="h-3 w-3" />
            {busy ? "Disabling…" : "Disable"}
          </Button>
        </div>
      )}
    </section>
  );
}
