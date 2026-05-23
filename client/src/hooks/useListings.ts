import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { Listing, ListingsResponse, PriceCache } from "../types";

/** The shape of `card` embedded on the all-listings response */
export interface ListingCardEmbed {
  id: string;
  pokemonTcgId: string;
  cardName: string;
  setName: string;
  cardNumber: string | null;
  variant: string;
  /** Null until the first pokemontcg.io fetch lands */
  priceCache: PriceCache | null;
}

export type ListingWithCard = Listing & { card: ListingCardEmbed };

/** All listings across every watched card — used by the Dashboard feed */
export function useAllListings() {
  return useQuery({
    queryKey: ["listings", "all"],
    queryFn: async (): Promise<ListingWithCard[]> => {
      const { data } = await api.get<{ listings: ListingWithCard[] }>(
        "/api/listings"
      );
      return data.listings;
    },
    // Re-fetch every 25 min to align with the 30-min server cache TTL
    refetchInterval: 25 * 60 * 1000,
  });
}

/** Listings for a specific card — used by CardDetailDrawer */
export function useCardListings(cardId: string | null) {
  return useQuery({
    queryKey: ["listings", cardId],
    queryFn: async (): Promise<ListingsResponse> => {
      const { data } = await api.get<ListingsResponse>(`/api/listings/${cardId}`);
      return data;
    },
    enabled: !!cardId,
  });
}

/** Force-refresh listings for a specific card (bypasses 30-min cache) */
export function useRefreshListings(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post(`/api/listings/${cardId}/refresh`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listings"] });
      toast.success("Listings refreshed");
    },
    onError: () => {
      toast.error("Refresh failed — try again");
    },
  });
}

/** Force-refresh ALL listings (used by the global Refresh Now button) */
export function useRefreshAllListings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cardIds: string[]) => {
      await Promise.allSettled(
        cardIds.map((id) => api.post(`/api/listings/${id}/refresh`))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listings"] });
      toast.success("All listings refreshed");
    },
  });
}
