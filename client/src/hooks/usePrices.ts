import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { PricesResponse } from "../types";

/** Fetch PriceCharting market prices for a single watched card */
export function usePrices(cardId: string | null) {
  return useQuery({
    queryKey: ["prices", cardId],
    queryFn: async (): Promise<PricesResponse> => {
      const { data } = await api.get<PricesResponse>(`/api/prices/${cardId}`);
      return data;
    },
    enabled: !!cardId,
    // Prices are cached 6 hours server-side; stale after 5.5 hours client-side
    staleTime: 5.5 * 60 * 60 * 1000,
  });
}
