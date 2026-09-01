import type { Member, Vendor, WebContact } from "@/shared/types";

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export interface AccountListResponse {
  accounts: Member[];
}

export interface ModuleRecords {
  vendors: Vendor[];
  contacts: WebContact[];
}

export type ModuleName = keyof ModuleRecords;
