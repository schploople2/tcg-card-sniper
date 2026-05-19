import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't refetch on window focus in dev — too noisy when hot-reloading
      refetchOnWindowFocus: import.meta.env.PROD,
      // Listings are cached for 30 min server-side; stale after 25 min client-side
      staleTime: 25 * 60 * 1000,
      retry: 1,
    },
  },
});
