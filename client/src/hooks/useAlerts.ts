import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { Alert } from "../types";

/**
 * Polling cadence for both list + count queries. 60s is generous given how
 * rarely new alerts land between visible UI ticks; lowering would push
 * us toward SSE which is unnecessary at this scale. Tab-hidden refetches
 * are paused automatically by react-query's `refetchIntervalInBackground: false`.
 */
const POLL_INTERVAL_MS = 60_000;

const ALERTS_KEY = ["alerts"] as const;
const ALERTS_COUNT_KEY = ["alerts", "count"] as const;

interface AlertsResponse {
  alerts: Alert[];
}

interface AlertsCountResponse {
  unread: number;
}

/**
 * Fetch the recent-alerts feed (default 50 rows, joined with watched card
 * and listing snapshot). Used by the NotificationDrawer.
 */
export function useAlerts(opts?: { unreadOnly?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: [...ALERTS_KEY, opts?.unreadOnly ?? false],
    queryFn: async (): Promise<AlertsResponse> => {
      const { data } = await api.get<AlertsResponse>("/api/alerts", {
        params: { unread: opts?.unreadOnly ? "true" : undefined, limit: 50 },
      });
      return data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    enabled: opts?.enabled ?? true,
  });
}

/**
 * Lightweight unread-count poll for the bell badge. Separate query (with its
 * own key) so the badge can update without paying the full feed payload.
 *
 * Side-effect: when the count *increases* between polls, fire a sonner toast.
 * This is the closest thing to a real-time push we'll do without websockets.
 * The ref-based diff means we don't spam toasts on initial load or refresh —
 * only on actual deltas during the same browser session.
 */
export function useUnreadAlertsCount() {
  const previous = useRef<number | null>(null);

  const query = useQuery({
    queryKey: ALERTS_COUNT_KEY,
    queryFn: async (): Promise<AlertsCountResponse> => {
      const { data } = await api.get<AlertsCountResponse>("/api/alerts/count");
      return data;
    },
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (query.data == null) return;
    const next = query.data.unread;
    // First successful response — seed the ref without toasting.
    if (previous.current === null) {
      previous.current = next;
      return;
    }
    if (next > previous.current) {
      const delta = next - previous.current;
      toast.success(
        delta === 1 ? "New deal alert" : `${delta} new deal alerts`,
        { duration: 5_000 }
      );
    }
    previous.current = next;
  }, [query.data]);

  return query;
}

/**
 * Mark a single alert read. Optimistically updates the count cache so the
 * bell badge decrements before the network round-trip lands.
 */
export function useMarkAlertRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch<{ id: string; readAt: string }>(
        `/api/alerts/${id}/read`
      );
      return data;
    },
    onMutate: async (id) => {
      // Optimistic count decrement. We only decrement if there's a current
      // count > 0 — guard against stale cache where the alert is already read.
      await qc.cancelQueries({ queryKey: ALERTS_COUNT_KEY });
      const prev = qc.getQueryData<AlertsCountResponse>(ALERTS_COUNT_KEY);
      if (prev && prev.unread > 0) {
        qc.setQueryData<AlertsCountResponse>(ALERTS_COUNT_KEY, {
          unread: prev.unread - 1,
        });
      }
      return { prev, id };
    },
    onError: (_e, _id, ctx) => {
      // Roll back the optimistic count.
      if (ctx?.prev) qc.setQueryData(ALERTS_COUNT_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ALERTS_KEY });
      qc.invalidateQueries({ queryKey: ALERTS_COUNT_KEY });
    },
  });
}

/** Mark every unread alert read. */
export function useMarkAllAlertsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ updated: number }>(
        "/api/alerts/read-all"
      );
      return data;
    },
    onSuccess: ({ updated }) => {
      qc.setQueryData<AlertsCountResponse>(ALERTS_COUNT_KEY, { unread: 0 });
      qc.invalidateQueries({ queryKey: ALERTS_KEY });
      if (updated > 0) {
        toast.success(`Marked ${updated} alerts read`);
      }
    },
  });
}
