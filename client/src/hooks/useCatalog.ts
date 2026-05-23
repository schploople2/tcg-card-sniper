import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { CatalogSearchResponse, CatalogCard } from "../types";

/**
 * Search the pokemontcg.io catalog via the server proxy. The query string is
 * expected to be already-debounced by the caller; we just key the cache on it
 * so identical queries reuse results.
 *
 * Returns an empty list (no fetch) when the trimmed query is shorter than 2
 * characters so we don't hammer pokemontcg.io with single-letter prefixes.
 */
export function useCatalogSearch(query: string, enabled = true) {
  const trimmed = query.trim();
  const isShort = trimmed.length < 2;

  return useQuery({
    queryKey: ["catalog", "search", trimmed],
    queryFn: async (): Promise<CatalogCard[]> => {
      const { data } = await api.get<CatalogSearchResponse>(
        "/api/catalog/search",
        { params: { q: trimmed, pageSize: 20 } }
      );
      return data.results;
    },
    enabled: enabled && !isShort,
    // Catalog data changes slowly; keep results for the dialog lifetime
    staleTime: 5 * 60 * 1000,
  });
}
