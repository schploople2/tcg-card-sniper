import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type {
  AddedLotCard,
  LotAnnotation,
  LotImage,
  LotRevaluation,
  LotSuggestionsResponse,
  LotsSearchResponse,
} from "../types";

/**
 * Search eBay for multi-card lot listings and parse them.
 *
 * The endpoint does the heavy lifting (eBay fetch → lot detection → card
 * extraction → valuation → DB upsert). The hook just shapes it as a
 * react-query.
 *
 * staleTime of 30 minutes matches the server-side Lot TTL — refetching
 * sooner just re-hits eBay for no new data.
 */
export function useLotSearch(query: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["lots", "search", query],
    queryFn: async (): Promise<LotsSearchResponse> => {
      const { data } = await api.get<LotsSearchResponse>("/api/lots/search", {
        params: { q: query, pageSize: 24 },
      });
      return data;
    },
    enabled: (opts?.enabled ?? true) && query.trim().length >= 2,
    staleTime: 30 * 60 * 1000,
  });
}

// ─── Annotation hooks (Pb-next) ───────────────────────────────────────────────

const ANNOTATION_KEY = (ebayItemId: string) => ["lots", "annotation", ebayItemId] as const;

/**
 * Fetch the current user's annotation for a lot. Returns a zeroed-out
 * shape (no addedCards, no notes, null timestamps) when the user hasn't
 * saved anything yet — UI seeds the modal from this in either case.
 */
export function useLotAnnotation(ebayItemId: string | null) {
  return useQuery({
    queryKey: ANNOTATION_KEY(ebayItemId ?? ""),
    queryFn: async (): Promise<LotAnnotation> => {
      const { data } = await api.get<LotAnnotation>(
        `/api/lots/${ebayItemId}/annotation`
      );
      return data;
    },
    enabled: !!ebayItemId,
    staleTime: 60 * 1000, // 1 min; annotations rarely change between refetches
  });
}

interface SaveAnnotationArgs {
  ebayItemId: string;
  addedCards: AddedLotCard[];
  notes: string | null;
}

interface SaveAnnotationResponse extends LotAnnotation {
  revaluation: LotRevaluation;
}

/**
 * Upsert the user's annotation. Returns the new annotation plus a fresh
 * revaluation (auto vs. with-annotation estimates), used by the modal
 * to show the live "your additions changed the total" indicator.
 */
export function useSaveAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ebayItemId,
      addedCards,
      notes,
    }: SaveAnnotationArgs): Promise<SaveAnnotationResponse> => {
      const { data } = await api.put<SaveAnnotationResponse>(
        `/api/lots/${ebayItemId}/annotation`,
        { addedCards, notes }
      );
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ANNOTATION_KEY(data.ebayItemId) });
      toast.success("Analysis saved");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to save analysis");
    },
  });
}

/**
 * Get the full image set for a lot listing. Server fetches from eBay on
 * cache miss and persists to LotImage; subsequent loads are instant.
 */
/**
 * Pc — Trigger vision-AI suggestions for a lot. POST because the first
 * call has side effects (DB write + Anthropic API spend); subsequent
 * calls replay from cache. UI exposes this behind a "✨ Suggest cards"
 * button so the user opts into the spend explicitly.
 *
 * Returns null when the server has the provider disabled (`OCR_PROVIDER=none`)
 * — the mutation surfaces the 503 via onError so the UI can fall back gracefully.
 */
export function useLotSuggestions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ebayItemId: string): Promise<LotSuggestionsResponse> => {
      const { data } = await api.post<LotSuggestionsResponse>(
        `/api/lots/${ebayItemId}/ocr-suggestions`
      );
      return data;
    },
    onSuccess: (data) => {
      // Cache for instant replay on re-open of the same lot.
      qc.setQueryData(
        ["lots", "suggestions", data.ebayItemId],
        data
      );
    },
    onError: (err: { response?: { status?: number; data?: { error?: string } } }) => {
      if (err.response?.status === 503) {
        toast.info("AI suggestions are not enabled on this server yet.");
      } else {
        toast.error(err.response?.data?.error ?? "Failed to get suggestions");
      }
    },
  });
}

export function useLotImages(ebayItemId: string | null) {
  return useQuery({
    queryKey: ["lots", "images", ebayItemId],
    queryFn: async (): Promise<{ images: LotImage[] }> => {
      const { data } = await api.get<{ images: LotImage[] }>(
        `/api/lots/${ebayItemId}/images`
      );
      return data;
    },
    enabled: !!ebayItemId,
    staleTime: 60 * 60 * 1000, // 1h — eBay listings don't rotate images often
  });
}
