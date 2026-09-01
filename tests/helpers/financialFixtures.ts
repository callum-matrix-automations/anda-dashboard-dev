import type {
  FinancialFolder,
  FinancialRecord,
  FinancialRecordListResponse,
  FinancialRecordMetadataInput,
} from "../../src/shared/contracts/financial";

export const financialActorId = "10000000-0000-4000-8000-000000000003";
export const financialFolderId = "20260000-0000-4000-8000-000000000026";
export const customFinancialFolderId = "22000000-0000-4000-8000-000000000001";
export const financialRecordId = "23000000-0000-4000-8000-000000000001";

export function financialFolder(overrides: Partial<FinancialFolder> = {}): FinancialFolder {
  return {
    id: financialFolderId,
    name: "2026",
    isSystem: true,
    sortOrder: 2,
    version: 1,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

export function financialMetadata(overrides: Partial<FinancialRecordMetadataInput> = {}): FinancialRecordMetadataInput {
  return {
    folderId: financialFolderId,
    displayName: "August operating statement",
    recordYear: 2026,
    recordMonth: 8,
    description: "Monthly operating statement.",
    ...overrides,
  };
}

export function financialRecord(overrides: Partial<FinancialRecord> = {}): FinancialRecord {
  return {
    ...financialMetadata(),
    id: financialRecordId,
    version: 1,
    originalFileName: "august-operating-statement.pdf",
    mimeType: "application/pdf",
    sizeBytes: 512,
    createdBy: financialActorId,
    updatedBy: financialActorId,
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    archivedBy: null,
    archivedAt: null,
    contentUrl: `/api/financials/records/${financialRecordId}/content`,
    ...overrides,
  };
}

export function financialListResponse(overrides: Partial<FinancialRecordListResponse> = {}): FinancialRecordListResponse {
  return {
    items: [financialRecord()],
    total: 1,
    limit: 25,
    offset: 0,
    summary: { activeTotal: 1, archivedTotal: 0, activeSizeBytes: 512 },
    ...overrides,
  };
}

export function pdfBytes() {
  return Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);
}
