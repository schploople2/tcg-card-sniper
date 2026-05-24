import { useEffect, useState } from "react";
import { Send, Save, Trash2, ExternalLink } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useSettings,
  useSaveSettings,
  useTestWebhook,
} from "@/hooks/useSettings";

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
      </div>
    </PageShell>
  );
}
