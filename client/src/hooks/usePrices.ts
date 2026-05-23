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

/** A single point on the price history line: { date, market, source }. */
export interface PriceHistoryPoint {
  date: string; // ISO timestamp
  market: number;
  source: string;
  currency: string;
}

export interface PriceHistoryResponse {
  cardId: string;
  variant: string;
  days: number;
  points: PriceHistoryPoint[];
}

/**
 * Fetch the daily market-price history for a single watched card.
 *
 * Returns empty `points: []` for cards that haven't seen a snapshot yet
 * (brand new, or added after the day's snapshot ran). Caller should render
 * a flat-line "today only" state in that case rather than an empty chart.
 *
 * Long staleTime: history only changes once a day, so we don't want to
 * thrash the endpoint on every drawer open.
 */
export function usePriceHistory(cardId: string | null, days = 30) {
  return useQuery({
    queryKey: ["priceHistory", cardId, days],
    queryFn: async (): Promise<PriceHistoryResponse> => {
      const { data } = await api.get<PriceHistoryResponse>(
        `/api/prices/${cardId}/history`,
        { params: { days } }
      );
      return data;
    },
    enabled: !!cardId,
    // 12h client cache — chart data updates once a day server-side, so
    // refetching faster than that is wasted bandwidth.
    staleTime: 12 * 60 * 60 * 1000,
  });
}
