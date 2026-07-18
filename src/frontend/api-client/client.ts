import type {
  AccountListResponse,
  ApiErrorBody,
  MeetingListResponse,
  MeetingResponse,
  ModuleName,
  ModuleRecords,
} from "@/shared/contracts/api";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiErrorBody | null;
    throw new ApiClientError(
      body?.error ?? "The backend API is not available.",
      response.status,
      body?.code,
    );
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  meetings: {
    async list(queue?: string): Promise<MeetingListResponse["meetings"]> {
      const query = queue ? `?queue=${encodeURIComponent(queue)}` : "";
      return (await request<MeetingListResponse>(`/api/meetings${query}`)).meetings;
    },
    async get(id: string): Promise<MeetingResponse["meeting"]> {
      return (await request<MeetingResponse>(`/api/meetings/${encodeURIComponent(id)}`)).meeting;
    },
    async search(query: string): Promise<MeetingListResponse["meetings"]> {
      return (await request<MeetingListResponse>(`/api/meetings/search?q=${encodeURIComponent(query)}`)).meetings;
    },
  },
  accounts: {
    async list(): Promise<AccountListResponse["accounts"]> {
      return (await request<AccountListResponse>("/api/accounts")).accounts;
    },
  },
  modules: {
    async list<TName extends ModuleName>(name: TName): Promise<ModuleRecords[TName]> {
      return request<ModuleRecords[TName]>(`/api/${encodeURIComponent(name)}`);
    },
  },
};
