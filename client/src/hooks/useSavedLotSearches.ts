import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * B4 — Saved lot searches CRUD.
 *
 * A saved search scopes LOT_HOT alerts (A1) to lots whose title matches
 * the user's saved query AND whose value passes the optional filters.
 * Without any saved searches, the user receives no lot alerts.
 */

export interface SavedLotSearch {
  id: string;
  query: string;
  minLowEstimate: number | string | null;
  maxAskingPrice: number | string | null;
  createdAt: string;
  lastEvaluatedAt: string | null;
}

const KEY = ["savedLotSearches"] as const;

export function useSavedLotSearches() {
  return useQuery<{ savedSearches: SavedLotSearch[] }>({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<{ savedSearches: SavedLotSearch[] }>(
        "/api/saved-lot-searches"
      );
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCreateSavedLotSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      query: string;
      minLowEstimate?: number | null;
      maxAskingPrice?: number | null;
    }) => {
      const { data } = await api.post<SavedLotSearch>(
        "/api/saved-lot-searches",
        input
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Saved — lot alerts now scoped to this search");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't save search");
    },
  });
}

export function useDeleteSavedLotSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/saved-lot-searches/${id}`);
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
