import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * D2 — Per-user watched seller usernames.
 *
 * v1: piggybacks on the existing 30-min refresh-listings cron. A
 * SELLER_LISTING alert fires for any listing whose seller matches a
 * WatchedSeller row, scoped to the user who added the watch.
 */

export interface WatchedSeller {
  id: string;
  sellerName: string;
  note: string | null;
  createdAt: string;
}

const KEY = ["watchedSellers"] as const;

export function useWatchedSellers() {
  return useQuery<{ watchedSellers: WatchedSeller[] }>({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<{ watchedSellers: WatchedSeller[] }>(
        "/api/watched-sellers"
      );
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCreateWatchedSeller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { sellerName: string; note?: string | null }) => {
      const { data } = await api.post<WatchedSeller>(
        "/api/watched-sellers",
        input
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Watching this seller — new listings will alert");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't watch seller");
    },
  });
}

export function useDeleteWatchedSeller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/watched-sellers/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Removed");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't remove");
    },
  });
}
