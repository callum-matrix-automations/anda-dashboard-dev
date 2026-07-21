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
  type MeetingApiDetail,
  type MeetingApiListQuery,
  type MeetingApiListResponse,
  type MeetingApiMutationResponse,
} from "../../shared/contracts/meetingApi";
import type { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly currentVersion?: number | null,
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
    );
  }

  return schema.parse(await response.json());
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

function meetingListSearch(query: Partial<MeetingApiListQuery>): string {
  const search = new URLSearchParams();
  if (query.queue) search.set("queue", query.queue);
  if (query.status) search.set("status", query.status);
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
