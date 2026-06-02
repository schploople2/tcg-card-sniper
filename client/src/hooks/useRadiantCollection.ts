import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";

export type RadiantCard = {
  id: string;
  name: string;
  number: string;
  rarity: string | null;
  setId: string;
  setName: string;
  imageSmall: string | null;
  imageLarge: string | null;
  variants: string[];
  collected: boolean;
};

export type RadiantSet = {
  setId: string;
  setName: string;
  total: number;
  collected: number;
  cards: RadiantCard[];
};

export type RadiantCollectionResponse = {
  total: number;
  collected: number;
  sets: RadiantSet[];
};

export const RADIANT_KEY = ["collection", "radiant"] as const;

export function useRadiantCollection() {
  return useQuery({
    queryKey: RADIANT_KEY,
    queryFn: async (): Promise<RadiantCollectionResponse> => {
      const { data } = await api.get("/api/collection/radiant");
      return data;
    },
  });
}

export function useToggleCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cardId: string): Promise<{ cardId: string; collected: boolean }> => {
      const { data } = await api.post(`/api/collection/${cardId}/toggle`);
      return data;
    },
    // Optimistic update: flip the bit + recompute counters before the
    // request lands so taps feel instant. onError reverts.
    onMutate: async (cardId: string) => {
      await qc.cancelQueries({ queryKey: RADIANT_KEY });
      const previous = qc.getQueryData<RadiantCollectionResponse>(RADIANT_KEY);
      if (!previous) return { previous };

      const next: RadiantCollectionResponse = {
        ...previous,
        sets: previous.sets.map((s) => {
          const cards = s.cards.map((c) =>
            c.id === cardId ? { ...c, collected: !c.collected } : c,
          );
          return {
            ...s,
            cards,
            collected: cards.filter((c) => c.collected).length,
          };
        }),
        collected: 0,
      };
      next.collected = next.sets.reduce((sum, s) => sum + s.collected, 0);

      qc.setQueryData(RADIANT_KEY, next);
      return { previous };
    },
    onError: (err: { response?: { data?: { error?: string } } }, _cardId, ctx) => {
      if (ctx?.previous) qc.setQueryData(RADIANT_KEY, ctx.previous);
      toast.error(err.response?.data?.error ?? "Failed to update collection");
    },
    // Don't refetch on success — the optimistic update already reflects truth.
    // A refetch would cause a brief flicker if the server is slow.
  });
}
