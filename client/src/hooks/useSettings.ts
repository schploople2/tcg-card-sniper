import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * B1 — user settings (Discord webhook URL today; push subs / email
 * cadence to follow in later issues). Settings rarely change; we cache
 * for the session and explicitly invalidate after a mutation.
 */

const SETTINGS_KEY = ["settings"] as const;

export interface UserSettings {
  /** Redacted webhook URL — only the last 10 chars, prefixed with "…". */
  discordWebhookUrl: string | null;
  discordWebhookConfigured: boolean;
}

export function useSettings() {
  return useQuery<UserSettings>({
    queryKey: SETTINGS_KEY,
    queryFn: async () => {
      const { data } = await api.get<UserSettings>("/api/settings");
      return data;
    },
    staleTime: Infinity,
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { discordWebhookUrl: string | null }) => {
      const { data } = await api.put<UserSettings>("/api/settings", input);
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(SETTINGS_KEY, data);
      toast.success("Settings saved");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't save settings");
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ ok: true; status: number }>(
        "/api/settings/test-webhook"
      );
      return data;
    },
    onSuccess: () => {
      toast.success("Test message sent — check Discord");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(
        err.response?.data?.error ?? "Discord didn't accept the test message"
      );
    },
  });
}
