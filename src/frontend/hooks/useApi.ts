"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiClient } from "@/frontend/api-client/client";
import {
  MEETING_QUEUE_REFRESH_MS,
  meetingDetailRefreshInterval,
} from "@/frontend/presentation/meetingRefresh";
import type { ModuleName } from "@/shared/contracts/api";
import type { MeetingApiQueue } from "@/shared/contracts/meetingApi";
import type { MeetingArchiveQuery } from "@/shared/contracts/meetingArchive";
import type { MeetingReviewDraft } from "@/shared/contracts/meetingReview";

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
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.retryAnalysis(meetingId, expectedVersion)
    ),
  );
}

export function useSaveMeetingDraft() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion, draft }: { meetingId: string; expectedVersion: number; draft: MeetingReviewDraft }) => (
      apiClient.meetings.saveDraft(meetingId, expectedVersion, draft)
    ),
  );
}

export function useDeferMeeting() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion, note }: { meetingId: string; expectedVersion: number; note: string }) => (
      apiClient.meetings.defer(meetingId, expectedVersion, note)
    ),
  );
}

export function useResumeMeeting() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.resume(meetingId, expectedVersion)
    ),
  );
}

export function useMarkMeetingReady() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.markReady(meetingId, expectedVersion)
    ),
  );
}

export function useApproveMeeting() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion, acknowledgeUnresolvedVotes }: { meetingId: string; expectedVersion: number; acknowledgeUnresolvedVotes: boolean }) => (
      apiClient.meetings.approve(meetingId, expectedVersion, acknowledgeUnresolvedVotes)
    ),
  );
}

export function useRetryMeetingPdf() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.retryPdf(meetingId, expectedVersion)
    ),
  );
}

export function useRetryMeetingSigning() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.retrySigning(meetingId, expectedVersion)
    ),
  );
}

export function useMeetingSigningSession(meetingId: string, documentVersion: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["meeting-signing-session", meetingId, documentVersion],
    queryFn: () => apiClient.meetings.signingSession(meetingId),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useRejectMeetingSigning() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion, comment }: { meetingId: string; expectedVersion: number; comment: string }) => (
      apiClient.meetings.rejectSigning(meetingId, expectedVersion, comment)
    ),
  );
}

export function useRetryMeetingSigningOutcome() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.retrySigningOutcome(meetingId, expectedVersion)
    ),
  );
}

export function useArchive(query: Partial<MeetingArchiveQuery>, enabled = true) {
  return useQuery({
    queryKey: ["archive", query],
    queryFn: () => apiClient.archive.list(query),
    enabled,
    retry: false,
  });
}

export function useArchiveMeeting(meetingId: string) {
  return useQuery({
    queryKey: ["archive-meeting", meetingId],
    queryFn: () => apiClient.archive.get(meetingId),
    retry: false,
  });
}

export function useArchiveDocumentAccess() {
  return useMutation({ mutationFn: (meetingId: string) => apiClient.archive.documentAccess(meetingId) });
}

export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: () => apiClient.accounts.list(), retry: false });
}

export function useModuleRecords(name: ModuleName) {
  return useQuery({ queryKey: ["module", name], queryFn: () => apiClient.modules.list(name), retry: false });
}

function useMeetingMutation<TVariables extends { meetingId: string }>(
  mutationFn: (variables: TVariables) => ReturnType<typeof apiClient.meetings.retryAnalysis>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meeting", variables.meetingId] }),
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["meeting-search"] }),
      ]);
    },
    onError: async (error, variables) => {
      if (error instanceof ApiClientError && error.code === "version_conflict") {
        await queryClient.invalidateQueries({ queryKey: ["meeting", variables.meetingId] });
      }
    },
  });
}
