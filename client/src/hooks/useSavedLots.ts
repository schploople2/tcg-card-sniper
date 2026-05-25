import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

/**
 * u8y — Per-user saved (pinned) lot listings.
 *
 * Save snapshots title/imageUrl/ebayUrl/listingPrice on the SavedLot row
 * so the saved list keeps rendering after the underlying Lot row evicts
 * (30-min TTL). Server enforces (userId, ebayItemId) unique → 409 on
 * duplicate save.
 */

export interface SavedLot {
  id: string;
  ebayItemId: string;
  title: string;
  imageUrl: string | null;
  ebayUrl: string;
  listingPrice: string; // Prisma Decimal serialises to string
  note: string | null;
  createdAt: string;
}

export interface CreateSavedLotInput {
  ebayItemId: string;
  title: string;
  imageUrl?: string | null;
  ebayUrl: string;
  listingPrice: number;
  note?: string | null;
}

const KEY = ["savedLots"] as const;

export function useSavedLots() {
  return useQuery<{ savedLots: SavedLot[] }>({
    queryKey: KEY,
    queryFn: async () => {
      const { data } = await api.get<{ savedLots: SavedLot[] }>(
        "/api/saved-lots"
      );
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCreateSavedLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSavedLotInput) => {
      const { data } = await api.post<SavedLot>("/api/saved-lots", input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Saved");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't save lot");
    },
  });
}

export function useDeleteSavedLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/saved-lots/${id}`);
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("Removed from Saved");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Couldn't remove");
    },
  });
}

/**
 * Derived helper: lets a card-level component know whether the current
 * user has saved this specific ebayItemId, without an extra round trip.
 * Reads from the same react-query cache as useSavedLots, so a save/unsave
 * elsewhere updates this synchronously.
 *
 * Returns null savedId if not saved — caller can then call
 * useCreateSavedLot to save, or pass the savedId to useDeleteSavedLot.
 */
export function useIsLotSaved(ebayItemId: string | null | undefined): {
  isSaved: boolean;
  savedId: string | null;
} {
  const { data } = useSavedLots();
  return useMemo(() => {
    if (!ebayItemId || !data) return { isSaved: false, savedId: null };
    const hit = data.savedLots.find((l) => l.ebayItemId === ebayItemId);
    return { isSaved: !!hit, savedId: hit?.id ?? null };
  }, [data, ebayItemId]);
}
