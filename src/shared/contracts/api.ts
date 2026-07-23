import type {
  FinancialLine,
  Member,
  Property,
  Vendor,
  WebContact,
} from "@/shared/types";

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export interface AccountListResponse {
  accounts: Member[];
}

export interface ModuleRecords {
  financials: FinancialLine[];
  properties: Property[];
  vendors: Vendor[];
  contacts: WebContact[];
}

export type ModuleName = keyof ModuleRecords;
