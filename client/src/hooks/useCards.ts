import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { WatchedCard, CreateCardPayload, UpdateCardPayload } from "../types";

export const CARDS_KEY = ["cards"] as const;

/** Fetch all watched cards (with best listing + price cache included) */
export function useCards() {
  return useQuery({
    queryKey: CARDS_KEY,
    queryFn: async (): Promise<WatchedCard[]> => {
      const { data } = await api.get("/api/cards");
      return data;
    },
  });
}

/** Add a card to the watchlist */
export function useCreateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCardPayload): Promise<WatchedCard> => {
      const { data } = await api.post("/api/cards", payload);
      return data;
    },
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success(`${card.cardName} added to watchlist`);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to add card");
    },
  });
}

/** Update a watched card (e.g. change target price) */
export function useUpdateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: UpdateCardPayload & { id: string }): Promise<WatchedCard> => {
      const { data } = await api.patch(`/api/cards/${id}`, payload);
      return data;
    },
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success(`${card.cardName} updated`);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to update card");
    },
  });
}

/** Remove a card from the watchlist */
export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/api/cards/${id}`);
    },
    onMutate: async (id) => {
      // Optimistic update — remove from cache immediately
      await qc.cancelQueries({ queryKey: CARDS_KEY });
      const prev = qc.getQueryData<WatchedCard[]>(CARDS_KEY);
      qc.setQueryData<WatchedCard[]>(CARDS_KEY, (old) =>
        old?.filter((c) => c.id !== id) ?? []
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      // Roll back on failure
      if (ctx?.prev) qc.setQueryData(CARDS_KEY, ctx.prev);
      toast.error("Failed to remove card");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success("Card removed from watchlist");
    },
  });
}
