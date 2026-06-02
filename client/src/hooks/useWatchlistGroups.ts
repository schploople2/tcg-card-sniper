import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { WatchlistGroup } from "../types";
import { CARDS_KEY } from "./useCards";

export const GROUPS_KEY = ["watchlist-groups"] as const;

type GroupsResponse = { groups: WatchlistGroup[] };

export function useWatchlistGroups() {
  return useQuery({
    queryKey: GROUPS_KEY,
    queryFn: async (): Promise<WatchlistGroup[]> => {
      const { data } = await api.get<GroupsResponse>("/api/watchlist-groups");
      return data.groups;
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string): Promise<WatchlistGroup> => {
      const { data } = await api.post<WatchlistGroup>("/api/watchlist-groups", { name });
      return data;
    },
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: GROUPS_KEY });
      toast.success(`Group "${g.name}" created`);
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to create group");
    },
  });
}

export function useRenameGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: string; name: string }): Promise<WatchlistGroup> => {
      const { data } = await api.patch<WatchlistGroup>(
        `/api/watchlist-groups/${vars.id}`,
        { name: vars.name },
      );
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GROUPS_KEY });
      // Cards include groupId only — names live on the group. But the
      // header shown on the watchlist comes from the group query, which
      // we just invalidated. Cards don't need a refetch.
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to rename group");
    },
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await api.delete(`/api/watchlist-groups/${id}`);
    },
    onSuccess: () => {
      // The server orphans member cards to Ungrouped (onDelete: SetNull).
      // The card list returns groupId per row, so invalidating CARDS_KEY
      // refreshes the bucketing on the watchlist page immediately.
      qc.invalidateQueries({ queryKey: GROUPS_KEY });
      qc.invalidateQueries({ queryKey: CARDS_KEY });
      toast.success("Group deleted");
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      toast.error(err.response?.data?.error ?? "Failed to delete group");
    },
  });
}
