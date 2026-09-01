import { describe, expect, it, vi } from "vitest";
import {
  createFinancialFolderCreateHandler,
  createFinancialFolderListHandler,
  createFinancialRecordArchiveHandler,
  createFinancialRecordContentHandler,
  createFinancialRecordListHandler,
  createFinancialRecordUpdateHandler,
  createFinancialRecordUploadHandler,
} from "../../src/backend/integrations/financials/financialApiHandlers";
import type { createFinancialService } from "../../src/backend/services/financials/financialService";
import {
  financialActorId,
  financialFolder,
  financialListResponse,
  financialMetadata,
  financialRecord,
  financialRecordId,
  pdfBytes,
} from "../helpers/financialFixtures";

const actorResolver = vi.fn().mockResolvedValue({
  profileId: financialActorId,
  displayName: "Priya Shah",
  role: "USER" as const,
  isAdmin: false,
});

describe("financial API handlers", () => {
  it("lists folders and filtered records for a current app user", async () => {
    const service = serviceMock();
    const folders = await createFinancialFolderListHandler({ service, actorResolver })(request("/api/financials/folders"));
    const records = await createFinancialRecordListHandler({ service, actorResolver })(request(
      `/api/financials/records?q=statement&folderId=${financialFolder().id}&year=2026&month=8&status=archived&limit=10&offset=20`,
    ));
    expect(folders.status).toBe(200);
    expect(records.status).toBe(200);
    expect(service.listRecords).toHaveBeenCalledWith({
      q: "statement", folderId: financialFolder().id, year: 2026, month: 8,
      status: "archived", limit: 10, offset: 20,
    });
  });

  it("creates folders and reports duplicate names", async () => {
    const service = serviceMock();
    const create = createFinancialFolderCreateHandler({ service, actorResolver });
    expect((await create(jsonRequest("/api/financials/folders", "POST", { name: "Tax returns" }))).status).toBe(201);
    service.createFolder = vi.fn().mockResolvedValue({ status: "duplicate" });
    const duplicate = await createFinancialFolderCreateHandler({ service, actorResolver })(jsonRequest(
      "/api/financials/folders", "POST", { name: "2026" },
    ));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ error: { code: "financial_folder_duplicate" } });
  });

  it("uploads a validated multipart financial record", async () => {
    const service = serviceMock();
    const form = new FormData();
    const metadata = financialMetadata();
    form.set("folderId", metadata.folderId);
    form.set("displayName", metadata.displayName);
    form.set("recordYear", String(metadata.recordYear));
    form.set("recordMonth", String(metadata.recordMonth));
    form.set("description", metadata.description ?? "");
    form.set("file", new File([pdfBytes()], "statement.pdf", { type: "application/pdf" }));
    const response = await createFinancialRecordUploadHandler({ service, actorResolver })(new Request(
      "https://anda.test/api/financials/records", { method: "POST", body: form },
    ));
    expect(response.status).toBe(201);
    expect(service.uploadRecord).toHaveBeenCalledWith(expect.objectContaining({
      actorProfileId: financialActorId,
      fileName: "statement.pdf",
      declaredMimeType: "application/pdf",
      record: metadata,
    }));
  });

  it("maps version conflicts and archive state", async () => {
    const service = serviceMock();
    service.updateRecord = vi.fn().mockResolvedValue({ status: "conflict", version: 4 });
    const update = await createFinancialRecordUpdateHandler({ service, actorResolver })(jsonRequest(
      `/api/financials/records/${financialRecordId}`,
      "PATCH",
      { expectedVersion: 3, record: financialMetadata() },
    ), context(financialRecordId));
    expect(update.status).toBe(409);
    await expect(update.json()).resolves.toMatchObject({ error: { code: "version_conflict", currentVersion: 4 } });

    const archive = await createFinancialRecordArchiveHandler(true, { service: serviceMock(), actorResolver })(jsonRequest(
      `/api/financials/records/${financialRecordId}/archive`, "POST", { expectedVersion: 1 },
    ), context(financialRecordId));
    expect(archive.status).toBe(200);
  });

  it("streams files as private no-store attachments", async () => {
    const response = await createFinancialRecordContentHandler({ service: serviceMock(), actorResolver })(request(
      `/api/financials/records/${financialRecordId}/content`,
    ), context(financialRecordId));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes());
  });
});

function serviceMock(): ReturnType<typeof createFinancialService> {
  return {
    listFolders: vi.fn().mockResolvedValue({ folders: [financialFolder()] }),
    createFolder: vi.fn().mockResolvedValue({ status: "saved", folder: financialFolder({ isSystem: false }) }),
    updateFolder: vi.fn().mockResolvedValue({ status: "saved", folder: financialFolder({ isSystem: false }) }),
    listRecords: vi.fn().mockResolvedValue(financialListResponse()),
    getRecord: vi.fn().mockResolvedValue(financialRecord()),
    updateRecord: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord({ version: 2 }) }),
    setRecordArchived: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord({ version: 2, archivedAt: "2026-09-01T13:00:00.000Z", archivedBy: financialActorId }) }),
    uploadRecord: vi.fn().mockResolvedValue({ status: "saved", record: financialRecord() }),
    loadFile: vi.fn().mockResolvedValue({
      metadata: { storagePath: "records/test.pdf", originalFileName: "statement.pdf", mimeType: "application/pdf", sizeBytes: pdfBytes().byteLength },
      bytes: pdfBytes(),
    }),
  };
}

function request(path: string) { return new Request(`https://anda.test${path}`); }
function jsonRequest(path: string, method: string, body: unknown) { return new Request(`https://anda.test${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
function context(recordId: string) { return { params: Promise.resolve({ recordId }) }; }
