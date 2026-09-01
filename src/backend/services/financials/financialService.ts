import { randomUUID } from "node:crypto";
import type { FinancialRepository } from "../../repositories/financials/financialRepository";
import type { FinancialFileStorage } from "../../repositories/storage/financialFileStorage";
import { supabaseFinancialRepository } from "../../repositories/supabase/supabaseFinancialRepository";
import { supabaseFinancialFileStorage } from "../../repositories/supabase/supabaseFinancialFileStorage";
import {
  FINANCIAL_RECORD_MAX_BYTES,
  type FinancialRecordListQuery,
  type FinancialRecordMetadataInput,
  type FinancialRecordMimeType,
} from "../../../shared/contracts/financial";

export class FinancialServiceError extends Error {
  readonly code: string;

  constructor(message: string, { code = "financial_service_failed", cause }: {
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "FinancialServiceError";
    this.code = code;
  }
}

export function createFinancialService({
  repository = supabaseFinancialRepository,
  storage = supabaseFinancialFileStorage,
}: {
  repository?: FinancialRepository;
  storage?: FinancialFileStorage;
} = {}) {
  return {
    listFolders() {
      return repository.listFolders();
    },
    createFolder(actorProfileId: string, name: string) {
      return repository.createFolder(actorProfileId, name);
    },
    updateFolder(input: {
      folderId: string;
      expectedVersion: number;
      actorProfileId: string;
      name: string;
    }) {
      return repository.updateFolder(input);
    },
    listRecords(query: FinancialRecordListQuery) {
      return repository.listRecords(query);
    },
    getRecord(recordId: string) {
      return repository.getRecord(recordId);
    },
    updateRecord(input: {
      recordId: string;
      expectedVersion: number;
      actorProfileId: string;
      record: FinancialRecordMetadataInput;
    }) {
      return repository.updateRecord(input);
    },
    setRecordArchived(input: {
      recordId: string;
      expectedVersion: number;
      actorProfileId: string;
      archived: boolean;
    }) {
      return repository.setRecordArchived(input);
    },
    async uploadRecord(input: {
      actorProfileId: string;
      fileName: string;
      declaredMimeType: string;
      bytes: Uint8Array;
      record: FinancialRecordMetadataInput;
    }) {
      const originalFileName = validateFileName(input.fileName);
      const mimeType = validateFile(originalFileName, input.declaredMimeType, input.bytes);
      const recordId = randomUUID();
      const storagePath = `${recordId}/${recordId}.${extensionFor(mimeType)}`;
      await storage.store({ path: storagePath, bytes: input.bytes, mimeType });

      let result;
      try {
        result = await repository.attachRecord({
          recordId,
          actorProfileId: input.actorProfileId,
          storagePath,
          originalFileName,
          mimeType,
          sizeBytes: input.bytes.byteLength,
          record: input.record,
        });
      } catch (error) {
        await cleanupUpload(storage, storagePath);
        throw error;
      }

      if (result.status !== "saved") await cleanupUpload(storage, storagePath);
      return result;
    },
    async loadFile(recordId: string) {
      const metadata = await repository.getFileMetadata(recordId);
      if (!metadata) return null;
      return { metadata, bytes: await storage.load(metadata.storagePath) };
    },
  };
}

async function cleanupUpload(storage: FinancialFileStorage, storagePath: string) {
  try {
    await storage.remove(storagePath);
  } catch (cleanupError) {
    throw new FinancialServiceError("The financial file upload failed and cleanup was unsuccessful.", {
      code: "financial_file_cleanup_failed",
      cause: cleanupError,
    });
  }
}

function validateFileName(value: string) {
  const fileName = value.trim();
  if (!fileName || fileName.length > 255 || /[\\/\0]/u.test(fileName)) {
    throw new FinancialServiceError("The financial record filename is invalid.", {
      code: "invalid_financial_filename",
    });
  }
  return fileName;
}

function validateFile(fileName: string, declaredMimeType: string, bytes: Uint8Array): FinancialRecordMimeType {
  if (bytes.byteLength === 0 || bytes.byteLength > FINANCIAL_RECORD_MAX_BYTES) {
    throw new FinancialServiceError(
      bytes.byteLength > FINANCIAL_RECORD_MAX_BYTES
        ? "Financial records must be 25 MB or smaller."
        : "The financial record is empty.",
      { code: bytes.byteLength > FINANCIAL_RECORD_MAX_BYTES ? "financial_file_too_large" : "invalid_financial_file" },
    );
  }

  const lowerName = fileName.toLowerCase();
  const valid = (
    declaredMimeType === "application/pdf" && lowerName.endsWith(".pdf") && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])
  ) || (
    declaredMimeType === "text/csv" && lowerName.endsWith(".csv") && isTextCsv(bytes)
  ) || (
    declaredMimeType === "application/vnd.ms-excel" && lowerName.endsWith(".xls")
      && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
  ) || (
    declaredMimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      && lowerName.endsWith(".xlsx") && isXlsx(bytes)
  ) || (
    declaredMimeType === "image/jpeg" && /\.jpe?g$/u.test(lowerName)
      && startsWith(bytes, [0xff, 0xd8, 0xff])
  ) || (
    declaredMimeType === "image/png" && lowerName.endsWith(".png")
      && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  );

  if (!valid) {
    throw new FinancialServiceError("Upload a valid PDF, CSV, XLS, XLSX, JPEG or PNG file.", {
      code: "unsupported_financial_file_type",
    });
  }
  return declaredMimeType as FinancialRecordMimeType;
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

function isTextCsv(bytes: Uint8Array) {
  if (bytes.some((value) => value === 0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

function isXlsx(bytes: Uint8Array) {
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return false;
  const searchable = new TextDecoder("latin1").decode(bytes);
  return searchable.includes("[Content_Types].xml") && searchable.includes("xl/");
}

function extensionFor(mimeType: FinancialRecordMimeType) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "application/vnd.ms-excel") return "xls";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (mimeType === "image/jpeg") return "jpg";
  return "png";
}

export const financialService = createFinancialService();
