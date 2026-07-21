"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/frontend/api-client/client";
import {
  MEETING_QUEUE_REFRESH_MS,
  meetingDetailRefreshInterval,
} from "@/frontend/presentation/meetingRefresh";
import type { ModuleName } from "@/shared/contracts/api";
import type { MeetingApiQueue } from "@/shared/contracts/meetingApi";

export function useMeetings(queue: MeetingApiQueue = "all") {
  return useQuery({
    queryKey: ["meetings", queue],
    queryFn: () => apiClient.meetings.list({ queue, limit: 100, offset: 0 }),
    retry: false,
    refetchInterval: MEETING_QUEUE_REFRESH_MS,
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: ["meeting", id],
    queryFn: () => apiClient.meetings.get(id),
    retry: false,
    refetchInterval: (query) => meetingDetailRefreshInterval(query.state.data),
  });
}

export function useMeetingSearch(query: string) {
  return useQuery({
    queryKey: ["meeting-search", query],
    queryFn: () => apiClient.meetings.search(query),
    enabled: query.trim().length > 0,
    retry: false,
  });
}

export function useRetryMeetingAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.retryAnalysis(meetingId, expectedVersion)
    ),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting", variables.meetingId] }),
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["meeting-search"] }),
      ]);
    },
  });
}

export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: () => apiClient.accounts.list(), retry: false });
}

export function useModuleRecords(name: ModuleName) {
  return useQuery({ queryKey: ["module", name], queryFn: () => apiClient.modules.list(name), retry: false });
}
