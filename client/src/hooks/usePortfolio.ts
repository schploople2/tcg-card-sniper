import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type {
  PortfolioResponse,
  PortfolioItem,
  CreatePortfolioItemPayload,
  UpdatePortfolioItemPayload,
} from "../types";

export const PORTFOLIO_KEY = ["portfolio"] as const;

export function usePortfolio() {
  return useQuery({
    queryKey: PORTFOLIO_KEY,
    queryFn: async (): Promise<PortfolioResponse> => {
      const { data } = await api.get("/api/portfolio");
      return data;
    },
  });
}

export function useCreatePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: CreatePortfolioItemPayload
    ): Promise<PortfolioItem> => {
      const { data } = await api.post("/api/portfolio", payload);
      return data;
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      toast.success(`${item.label} added to your collection`);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to add item");
    },
  });
}

export function useUpdatePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: UpdatePortfolioItemPayload & { id: string }): Promise<PortfolioItem> => {
      const { data } = await api.patch(`/api/portfolio/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      toast.success("Item updated");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to update item");
    },
  });
}

export function useDeletePortfolioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/api/portfolio/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      toast.success("Item removed");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to remove item");
    },
  });
}
