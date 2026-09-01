import { describe, expect, it, vi } from "vitest";
import { createFinancialService } from "../../src/backend/services/financials/financialService";
import type { FinancialRepository } from "../../src/backend/repositories/financials/financialRepository";
import type { FinancialFileStorage } from "../../src/backend/repositories/storage/financialFileStorage";
import {
  financialActorId,
  financialFolder,
  financialMetadata,
  financialRecord,
  financialRecordId,
  pdfBytes,
} from "../helpers/financialFixtures";

describe("financial records service", () => {
  it("validates, stores and attaches a private financial file", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const service = createFinancialService({ repository, storage });

    const result = await service.uploadRecord({
      actorProfileId: financialActorId,
      fileName: "statement.pdf",
      declaredMimeType: "application/pdf",
      bytes: pdfBytes(),
      record: financialMetadata(),
    });

    expect(result).toMatchObject({ status: "saved", record: { displayName: "August operating statement" } });
    expect(storage.store).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "application/pdf", bytes: pdfBytes() }));
    expect(repository.attachRecord).toHaveBeenCalledWith(expect.objectContaining({
      actorProfileId: financialActorId,
      originalFileName: "statement.pdf",
      sizeBytes: pdfBytes().byteLength,
    }));
  });

  it("removes orphaned storage when metadata attachment fails", async () => {
    const repository = repositoryMock();
    repository.attachRecord = vi.fn().mockResolvedValue({ status: "folder_year_mismatch" });
    const storage = storageMock();
    const service = createFinancialService({ repository, storage });

    await expect(service.uploadRecord({
      actorProfileId: financialActorId,
      fileName: "statement.pdf",
      declaredMimeType: "application/pdf",
      bytes: pdfBytes(),
      record: financialMetadata(),
    })).resolves.toEqual({ status: "folder_year_mismatch" });
    expect(storage.remove).toHaveBeenCalledOnce();
  });

  it("rejects empty, oversized and spoofed files before storage", async () => {
    const storage = storageMock();
    const service = createFinancialService({ repository: repositoryMock(), storage });
    const input = { actorProfileId: financialActorId, fileName: "statement.pdf", declaredMimeType: "application/pdf", record: financialMetadata() };

    await expect(service.uploadRecord({ ...input, bytes: new Uint8Array() })).rejects.toMatchObject({ code: "invalid_financial_file" });
    await expect(service.uploadRecord({ ...input, bytes: new Uint8Array(25 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "financial_file_too_large" });
    await expect(service.uploadRecord({ ...input, bytes: Uint8Array.from([1, 2, 3, 4, 5]) })).rejects.toMatchObject({ code: "unsupported_financial_file_type" });
    expect(storage.store).not.toHaveBeenCalled();
  });

  it("loads private file bytes through stored metadata", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const service = createFinancialService({ repository, storage });
    const loaded = await service.loadFile(financialRecordId);
    expect(loaded?.bytes).toEqual(pdfBytes());
    expect(storage.load).toHaveBeenCalledWith("records/test.pdf");
  });
});

function repositoryMock(): FinancialRepository {
  return {
    listFolders: vi.fn().mockResolvedValue({ folders: [financialFolder()] }),
    createFolder: vi.fn().mockResolvedValue({ status: "saved", folder: financialFolder() }),
    updateFolder: vi.fn().mockResolvedValue({ status: "saved", folder: financialFolder() }),
    listRecords: vi.fn(),
    getRecord: vi.fn().mockResolvedValue(financialRecord()),
    attachRecord: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord() }),
    updateRecord: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord() }),
    setRecordArchived: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord() }),
    getFileMetadata: vi.fn().mockResolvedValue({
      storagePath: "records/test.pdf",
      originalFileName: "statement.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdfBytes().byteLength,
    }),
  };
}

function storageMock(): FinancialFileStorage {
  return {
    store: vi.fn().mockResolvedValue({ path: "records/test.pdf" }),
    load: vi.fn().mockResolvedValue(pdfBytes()),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}
