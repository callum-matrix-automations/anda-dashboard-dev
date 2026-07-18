"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/frontend/api-client/client";
import type { ModuleName } from "@/shared/contracts/api";

export function useMeetings(queue?: string) {
  return useQuery({ queryKey: ["meetings", queue ?? "all"], queryFn: () => apiClient.meetings.list(queue), retry: false });
}

export function useMeeting(id: string) {
  return useQuery({ queryKey: ["meeting", id], queryFn: () => apiClient.meetings.get(id), retry: false });
}

export function useMeetingSearch(query: string) {
  return useQuery({
    queryKey: ["meeting-search", query],
    queryFn: () => apiClient.meetings.search(query),
    enabled: query.trim().length > 0,
    retry: false,
  });
}

export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: () => apiClient.accounts.list(), retry: false });
}

export function useModuleRecords(name: ModuleName) {
  return useQuery({ queryKey: ["module", name], queryFn: () => apiClient.modules.list(name), retry: false });
}
