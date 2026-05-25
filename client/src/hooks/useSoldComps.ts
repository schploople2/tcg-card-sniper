import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/**
 * C1 — Sold-comp panel hook.
 *
 * Fetches up to 90 days of sold/completed eBay listings for a watched
 * card. The server caches the underlying scrape for 24h per query, so
 * repeated views of the same card are mostly DB reads.
 */

export interface SoldCompSummary {
  count: number;
  median: number | null;
  low: number | null;
  high: number | null;
  mostRecentAt: string | null;
}

export interface SoldCompRow {
  ebayItemId: string;
  title: string;
  soldPrice: number;
  shippingCost: number | null;
  totalPrice: number;
  conditionGrade: string | null;
  acceptedOffer: boolean;
  soldAt: string;
  imageUrl: string | null;
  ebayUrl: string;
}

export interface SoldCompsResponse {
  query: string;
  summary: SoldCompSummary;
  rows: SoldCompRow[];
  fromCache: boolean;
}

export function useSoldComps(cardId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["cards", cardId, "sold-comps"],
    queryFn: async (): Promise<SoldCompsResponse> => {
      const { data } = await api.get<SoldCompsResponse>(
        `/api/cards/${cardId}/sold-comps`
      );
      return data;
    },
    enabled: !!cardId && enabled,
    // The server caches the scrape for 24h; keep the client copy fresh for
    // an hour so opening the same drawer twice in a session is instant.
    staleTime: 60 * 60 * 1000,
  });
}
