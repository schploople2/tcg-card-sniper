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
    mutationFn: async (
      args: string | { ebayItemId: string; force?: boolean }
    ): Promise<LotSuggestionsResponse> => {
      const { ebayItemId, force } =
        typeof args === "string" ? { ebayItemId: args, force: false } : args;
      const { data } = await api.post<LotSuggestionsResponse>(
        `/api/lots/${ebayItemId}/ocr-suggestions${force ? "?force=true" : ""}`
      );
      return data;
    },
    onSuccess: (data) => {
      // Cache for instant replay on re-open of the same lot.
      qc.setQueryData(
        ["lots", "suggestions", data.ebayItemId],
        data
      );
      // A POST may have written fresh OCR (or force=true cleared cache
      // and re-OCR'd). Invalidate the cached-GET query so the next
      // mount of the modal re-reads, picking up new bulk data etc.
      qc.invalidateQueries({
        queryKey: ["lots", "cached-suggestions", data.ebayItemId],
      });
    },
    onError: (err: {
      response?: {
        status?: number;
        data?: { error?: string; providerStatus?: string };
      };
    }) => {
      const status = err.response?.status;
      const providerStatus = err.response?.data?.providerStatus;
      if (status === 503 && providerStatus === "all-failed") {
        // Vision was configured but every per-image call threw (credit out,
        // upstream 5xx, etc). Distinct from "provider disabled" because the
        // user CAN retry — surface that.
        toast.error(
          err.response?.data?.error ??
            "AI vision is temporarily unavailable. Please try again later."
        );
      } else if (status === 503) {
        toast.info("AI suggestions are not enabled on this server yet.");
      } else {
        toast.error(err.response?.data?.error ?? "Failed to get suggestions");
      }
    },
  });
}

/**
 * Cached-only GET counterpart to useLotSuggestions. Used by
 * LotAnalyzerModal on open to rehydrate AI suggestions + bulk panel
 * without prompting the user to re-click "Suggest cards from photos".
 *
 * Returns null when the server has nothing cached (204) so the modal
 * can fall back to the trigger button.
 */
export function useCachedLotSuggestions(ebayItemId: string | null) {
  return useQuery({
    queryKey: ["lots", "cached-suggestions", ebayItemId],
    queryFn: async (): Promise<LotSuggestionsResponse | null> => {
      const resp = await api.get<LotSuggestionsResponse>(
        `/api/lots/${ebayItemId}/ocr-suggestions`,
        // 204 has no body; axios resolves with data: "". Treat that as null.
        { validateStatus: (s) => s === 200 || s === 204 }
      );
      if (resp.status === 204) return null;
      return resp.data;
    },
    enabled: !!ebayItemId,
    // OCR cache on the server is essentially permanent (no eviction
    // policy in the LotImage model), so an hour client-side is fine.
    staleTime: 60 * 60 * 1000,
  });
}

/**
 * Live "lot price vs market value" valuation. Calls the non-mutating
 * POST /api/lots/:id/valuation endpoint with the user's current
 * addedCards, returns the same `LotRevaluation` shape that
 * useSaveAnnotation's response carries. Used by LotValuationPanel
 * to render the headline comparison.
 *
 * Keyed on (ebayItemId, JSON.stringify(addedCards)) so any edit to
 * additions invalidates and re-fetches.
 */
export function useLotValuation(
  ebayItemId: string | null,
  addedCards: AddedLotCard[]
) {
  return useQuery({
    queryKey: ["lots", "valuation", ebayItemId, addedCards],
    queryFn: async (): Promise<LotRevaluation> => {
      const { data } = await api.post<{ revaluation: LotRevaluation }>(
        `/api/lots/${ebayItemId}/valuation`,
        { addedCards }
      );
      return data.revaluation;
    },
    enabled: !!ebayItemId,
    // Cards' market prices change at most daily; valuation answers don't
    // need fresher than that for a session.
    staleTime: 60 * 60 * 1000,
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
