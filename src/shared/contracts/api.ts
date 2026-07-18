import type {
  FinancialLine,
  Meeting,
  Member,
  Property,
  Vendor,
  WebContact,
} from "@/shared/types";

export interface ApiErrorBody {
  error: string;
  code?: string;
}

export interface MeetingListResponse {
  meetings: Meeting[];
}

export interface MeetingResponse {
  meeting: Meeting;
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
