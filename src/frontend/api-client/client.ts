import type {
  AccountListResponse,
  ModuleName,
  ModuleRecords,
} from "@/shared/contracts/api";
import {
  MeetingApiDetailSchema,
  MeetingApiErrorResponseSchema,
  MeetingApiListResponseSchema,
  MeetingApiMutationResponseSchema,
  MeetingApiSigningSessionSchema,
  type MeetingApiDetail,
  type MeetingApiListQuery,
  type MeetingApiListResponse,
  type MeetingApiMutationResponse,
  type MeetingApiSigningSession,
} from "../../shared/contracts/meetingApi";
import {
  MeetingArchiveAccessSchema,
  MeetingArchiveDetailSchema,
  MeetingArchiveSearchResultSchema,
  type MeetingArchiveAccess,
  type MeetingArchiveDetail,
  type MeetingArchiveQuery,
  type MeetingArchiveSearchResult,
} from "../../shared/contracts/meetingArchive";
import type { MeetingReviewDraft } from "../../shared/contracts/meetingReview";
import {
  ManualTranscriptUploadResponseSchema,
  type ManualTranscriptUploadRequest,
  type ManualTranscriptUploadResponse,
} from "../../shared/contracts/manualTranscriptUpload";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentVersion?: number | null,
    readonly issues?: Array<{ path: string; message: string }>,
    readonly unresolvedVoteCount?: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const apiError = MeetingApiErrorResponseSchema.safeParse(body);
    const legacyMessage = isLegacyErrorBody(body) ? body.error : null;
    throw new ApiClientError(
      apiError.success
        ? apiError.data.error.message
        : legacyMessage ?? "The backend API is not available.",
      response.status,
      apiError.success ? apiError.data.error.code : undefined,
      apiError.success ? apiError.data.error.currentVersion : undefined,
      apiError.success ? apiError.data.error.issues : undefined,
      apiError.success ? apiError.data.error.unresolvedVoteCount : undefined,
    );
  }

  return schema.parse(await response.json());
}

async function requestBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const apiError = MeetingApiErrorResponseSchema.safeParse(body);
    throw new ApiClientError(
      apiError.success ? apiError.data.error.message : "The PDF preview is not available.",
      response.status,
      apiError.success ? apiError.data.error.code : undefined,
    );
  }
  return response.blob();
}

export const apiClient = {
  meetings: {
    async list(query: Partial<MeetingApiListQuery> = {}): Promise<MeetingApiListResponse> {
      const search = meetingListSearch(query);
      return request(`/api/meetings${search}`, MeetingApiListResponseSchema);
    },
    async get(id: string): Promise<MeetingApiDetail> {
      return request(`/api/meetings/${encodeURIComponent(id)}`, MeetingApiDetailSchema);
    },
    async search(query: string, limit = 25, offset = 0): Promise<MeetingApiListResponse> {
      const search = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) });
      return request(`/api/meetings/search?${search}`, MeetingApiListResponseSchema);
    },
    async retryAnalysis(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return request(
        `/api/meetings/${encodeURIComponent(id)}/analysis/retry`,
        MeetingApiMutationResponseSchema,
        { method: "POST", body: JSON.stringify({ expectedVersion }) },
      );
    },
    async saveDraft(id: string, expectedVersion: number, draft: MeetingReviewDraft): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "draft", "PATCH", { expectedVersion, draft });
    },
    async defer(id: string, expectedVersion: number, note: string): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "defer", "POST", { expectedVersion, note });
    },
    async resume(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "resume", "POST", { expectedVersion });
    },
    async markReady(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "ready", "POST", { expectedVersion });
    },
    async approve(id: string, expectedVersion: number, acknowledgeUnresolvedVotes: boolean): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "approve", "POST", { expectedVersion, acknowledgeUnresolvedVotes });
    },
    async retryPdf(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "pdf/retry", "POST", { expectedVersion });
    },
    async retrySigning(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "signing/retry", "POST", { expectedVersion });
    },
    async signingSession(id: string): Promise<MeetingApiSigningSession> {
      return request(
        `/api/meetings/${encodeURIComponent(id)}/signing-session`,
        MeetingApiSigningSessionSchema,
      );
    },
    async rejectSigning(id: string, expectedVersion: number, comment: string): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "signing/reject", "POST", { expectedVersion, comment });
    },
    async checkSigningStatus(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "signing-status/check", "POST", { expectedVersion });
    },
    async retrySigningOutcome(id: string, expectedVersion: number): Promise<MeetingApiMutationResponse> {
      return meetingMutation(id, "signing-outcome/retry", "POST", { expectedVersion });
    },
    async previewPdf(id: string): Promise<Blob> {
      return requestBlob(`/api/meetings/${encodeURIComponent(id)}/pdf/preview`);
    },
  },
  transcripts: {
    async upload(input: ManualTranscriptUploadRequest): Promise<ManualTranscriptUploadResponse> {
      return request(
        "/api/transcripts/upload",
        ManualTranscriptUploadResponseSchema,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
  },
  archive: {
    async list(query: Partial<MeetingArchiveQuery> = {}): Promise<MeetingArchiveSearchResult> {
      return request(`/api/archive${archiveSearch(query)}`, MeetingArchiveSearchResultSchema);
    },
    async get(meetingId: string): Promise<MeetingArchiveDetail> {
      return request(`/api/archive/${encodeURIComponent(meetingId)}`, MeetingArchiveDetailSchema);
    },
    async documentAccess(meetingId: string): Promise<MeetingArchiveAccess> {
      return request(
        `/api/archive/${encodeURIComponent(meetingId)}/document`,
        MeetingArchiveAccessSchema,
      );
    },
  },
  accounts: {
    async list(): Promise<AccountListResponse["accounts"]> {
      const response = await fetch("/api/accounts", { headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new ApiClientError("The backend API is not available.", response.status);
      return ((await response.json()) as AccountListResponse).accounts;
    },
  },
  modules: {
    async list<TName extends ModuleName>(name: TName): Promise<ModuleRecords[TName]> {
      const response = await fetch(`/api/${encodeURIComponent(name)}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) throw new ApiClientError("The backend API is not available.", response.status);
      return response.json() as Promise<ModuleRecords[TName]>;
    },
  },
};

function meetingMutation(
  id: string,
  action: string,
  method: "PATCH" | "POST",
  body: unknown,
): Promise<MeetingApiMutationResponse> {
  return request(
    `/api/meetings/${encodeURIComponent(id)}/${action}`,
    MeetingApiMutationResponseSchema,
    { method, body: JSON.stringify(body) },
  );
}

function meetingListSearch(query: Partial<MeetingApiListQuery>): string {
  const search = new URLSearchParams();
  if (query.queue) search.set("queue", query.queue);
  if (query.status) search.set("status", query.status);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  if (query.offset !== undefined) search.set("offset", String(query.offset));
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

function archiveSearch(query: Partial<MeetingArchiveQuery>): string {
  const search = new URLSearchParams();
  if (query.query) search.set("q", query.query);
  if (query.year !== undefined) search.set("year", String(query.year));
  if (query.category) search.set("category", query.category);
  if (query.limit !== undefined) search.set("limit", String(query.limit));
  if (query.offset !== undefined) search.set("offset", String(query.offset));
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

function isLegacyErrorBody(body: unknown): body is { error: string } {
  return typeof body === "object"
    && body !== null
    && "error" in body
    && typeof body.error === "string";
}
