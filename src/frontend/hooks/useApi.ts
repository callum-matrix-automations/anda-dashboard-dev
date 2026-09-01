"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClientError, apiClient } from "@/frontend/api-client/client";
import type { MeetingApiQueue } from "@/shared/contracts/meetingApi";
import type { MeetingArchiveQuery } from "@/shared/contracts/meetingArchive";
import type { MeetingReviewDraft } from "@/shared/contracts/meetingReview";
import type {
  FinancialFolderCreateRequest,
  FinancialFolderUpdateRequest,
  FinancialRecordListQuery,
  FinancialRecordMetadataInput,
  FinancialRecordUpdateRequest,
} from "@/shared/contracts/financial";
import type { ManualTranscriptUploadRequest } from "@/shared/contracts/manualTranscriptUpload";
import type {
  PropertyDraft,
  PropertyListQuery,
  PropertyUpdateRequest,
} from "@/shared/contracts/property";

export function useMeetings(queue: MeetingApiQueue = "all") {
  return useQuery({
    queryKey: ["meetings", queue],
    queryFn: () => apiClient.meetings.list({ queue, limit: 100, offset: 0 }),
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

export function useMeeting(id: string) {
  return useQuery({
    queryKey: ["meeting", id],
    queryFn: () => apiClient.meetings.get(id),
    retry: false,
    refetchInterval: false,
    refetchOnWindowFocus: false,
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

export function useUploadTranscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualTranscriptUploadRequest) => apiClient.transcripts.upload(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["meetings"] });
    },
  });
}

export function useCheckMeetingSigningStatus() {
  return useMeetingMutation(
    ({ meetingId, expectedVersion }: { meetingId: string; expectedVersion: number }) => (
      apiClient.meetings.checkSigningStatus(meetingId, expectedVersion)
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

export function useFinancialFolders() {
  return useQuery({
    queryKey: ["financial-folders"],
    queryFn: () => apiClient.financials.listFolders(),
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useCreateFinancialFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: FinancialFolderCreateRequest) => apiClient.financials.createFolder(input),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["financial-folders"] }),
  });
}

export function useUpdateFinancialFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ folderId, input }: { folderId: string; input: FinancialFolderUpdateRequest }) => (
      apiClient.financials.updateFolder(folderId, input)
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["financial-folders"] }),
  });
}

export function useFinancialRecords(query: Partial<FinancialRecordListQuery>) {
  return useQuery({
    queryKey: ["financial-records", query],
    queryFn: () => apiClient.financials.listRecords(query),
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useUploadFinancialRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ record, file }: { record: FinancialRecordMetadataInput; file: File }) => (
      apiClient.financials.uploadRecord(record, file)
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["financial-records"] }),
  });
}

export function useUpdateFinancialRecord() {
  return useFinancialRecordMutation(({ recordId, input }: { recordId: string; input: FinancialRecordUpdateRequest }) => (
    apiClient.financials.updateRecord(recordId, input)
  ));
}

export function useArchiveFinancialRecord() {
  return useFinancialRecordMutation(({ recordId, expectedVersion }: { recordId: string; expectedVersion: number }) => (
    apiClient.financials.archiveRecord(recordId, expectedVersion)
  ));
}

export function useRestoreFinancialRecord() {
  return useFinancialRecordMutation(({ recordId, expectedVersion }: { recordId: string; expectedVersion: number }) => (
    apiClient.financials.restoreRecord(recordId, expectedVersion)
  ));
}

export function useProperties(query: Partial<PropertyListQuery>) {
  return useQuery({
    queryKey: ["properties", query],
    queryFn: () => apiClient.properties.list(query),
    retry: false,
  });
}

export function useProperty(propertyId: string, enabled = true) {
  return useQuery({
    queryKey: ["property", propertyId],
    queryFn: () => apiClient.properties.get(propertyId),
    enabled,
    retry: false,
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (property: PropertyDraft) => apiClient.properties.create(property),
    onSuccess: async (property) => {
      queryClient.setQueryData(["property", property.id], property);
      await queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
  });
}

export function useUpdateProperty() {
  return usePropertyMutation(({ propertyId, input }: { propertyId: string; input: PropertyUpdateRequest }) => (
    apiClient.properties.update(propertyId, input)
  ));
}

export function useArchiveProperty() {
  return usePropertyMutation(({ propertyId, expectedVersion }: { propertyId: string; expectedVersion: number }) => (
    apiClient.properties.archive(propertyId, expectedVersion)
  ));
}

export function useRestoreProperty() {
  return usePropertyMutation(({ propertyId, expectedVersion }: { propertyId: string; expectedVersion: number }) => (
    apiClient.properties.restore(propertyId, expectedVersion)
  ));
}

export function useUploadPropertyImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, expectedVersion, file }: { propertyId: string; expectedVersion: number; file: File }) => (
      apiClient.properties.uploadImage(propertyId, expectedVersion, file)
    ),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["property", variables.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
      ]);
    },
  });
}

export function useRemovePropertyImage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ propertyId, imageId, expectedVersion }: { propertyId: string; imageId: string; expectedVersion: number }) => (
      apiClient.properties.removeImage(propertyId, imageId, expectedVersion)
    ),
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["property", variables.propertyId] }),
        queryClient.invalidateQueries({ queryKey: ["properties"] }),
      ]);
    },
  });
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

function usePropertyMutation<TVariables extends { propertyId: string }>(
  mutationFn: (variables: TVariables) => ReturnType<typeof apiClient.properties.update>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async (property, variables) => {
      queryClient.setQueryData(["property", variables.propertyId], property);
      await queryClient.invalidateQueries({ queryKey: ["properties"] });
    },
    onError: async (error, variables) => {
      if (error instanceof ApiClientError && error.code === "version_conflict") {
        await queryClient.invalidateQueries({ queryKey: ["property", variables.propertyId] });
      }
    },
  });
}

function useFinancialRecordMutation<TVariables extends { recordId: string }>(
  mutationFn: (variables: TVariables) => ReturnType<typeof apiClient.financials.updateRecord>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["financial-records"] }),
    onError: async (error) => {
      if (error instanceof ApiClientError && error.code === "version_conflict") {
        await queryClient.invalidateQueries({ queryKey: ["financial-records"] });
      }
    },
  });
}
