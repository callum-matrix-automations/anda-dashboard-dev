import type {
  FinancialFolder,
  FinancialRecord,
  FinancialRecordListQuery,
  FinancialRecordListResponse,
  FinancialRecordMetadataInput,
  FinancialRecordMimeType,
} from "../../../shared/contracts/financial";

export type FinancialFolderCreateResult =
  | { status: "saved"; folder: FinancialFolder }
  | { status: "duplicate" };

export type FinancialFolderUpdateResult =
  | { status: "saved"; folder: FinancialFolder }
  | { status: "not_found"; version: null }
  | { status: "conflict" | "system_folder" | "duplicate"; version: number };

export type FinancialRecordAttachResult =
  | { status: "saved"; record: FinancialRecord }
  | { status: "folder_not_found" | "folder_year_mismatch" };

export type FinancialRecordMutationResult =
  | { status: "saved"; record: FinancialRecord }
  | { status: "not_found"; version: null }
  | { status: "conflict" | "archived" | "invalid_state" | "folder_not_found" | "folder_year_mismatch"; version: number };

export interface FinancialFileMetadata {
  storagePath: string;
  originalFileName: string;
  mimeType: FinancialRecordMimeType;
  sizeBytes: number;
}

export interface FinancialRepository {
  listFolders(): Promise<{ folders: FinancialFolder[] }>;
  createFolder(actorProfileId: string, name: string): Promise<FinancialFolderCreateResult>;
  updateFolder(input: {
    folderId: string;
    expectedVersion: number;
    actorProfileId: string;
    name: string;
  }): Promise<FinancialFolderUpdateResult>;
  listRecords(query: FinancialRecordListQuery): Promise<FinancialRecordListResponse>;
  getRecord(recordId: string): Promise<FinancialRecord | null>;
  attachRecord(input: {
    recordId: string;
    actorProfileId: string;
    storagePath: string;
    originalFileName: string;
    mimeType: FinancialRecordMimeType;
    sizeBytes: number;
    record: FinancialRecordMetadataInput;
  }): Promise<FinancialRecordAttachResult>;
  updateRecord(input: {
    recordId: string;
    expectedVersion: number;
    actorProfileId: string;
    record: FinancialRecordMetadataInput;
  }): Promise<FinancialRecordMutationResult>;
  setRecordArchived(input: {
    recordId: string;
    expectedVersion: number;
    actorProfileId: string;
    archived: boolean;
  }): Promise<FinancialRecordMutationResult>;
  getFileMetadata(recordId: string): Promise<FinancialFileMetadata | null>;
}
