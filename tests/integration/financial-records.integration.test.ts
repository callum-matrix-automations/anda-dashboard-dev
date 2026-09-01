import { describe, expect, it } from "vitest";
import { createSupabaseFinancialFileStorage } from "../../src/backend/repositories/supabase/supabaseFinancialFileStorage";
import { createSupabaseFinancialRepository } from "../../src/backend/repositories/supabase/supabaseFinancialRepository";
import { createFinancialService } from "../../src/backend/services/financials/financialService";
import { financialActorId, pdfBytes } from "../helpers/financialFixtures";
import { localSupabaseConfiguration } from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const fixtureToken = "ANDA-022-INTEGRATION";

describe.skipIf(!configuration.configured)("local Supabase Financial Records Library", () => {
  it("persists folders, private files, month filters, updates, conflicts, archive and restore", async () => {
    const runToken = `${fixtureToken}-${crypto.randomUUID()}`;
    const repository = createSupabaseFinancialRepository(configuration);
    const storage = createSupabaseFinancialFileStorage(configuration);
    const service = createFinancialService({ repository, storage });
    const folders = await repository.listFolders();
    expect(folders.folders.filter((folder) => folder.isSystem).map((folder) => folder.name)).toEqual(["2024", "2025", "2026"]);
    const annual2026 = folders.folders.find((folder) => folder.name === "2026");
    if (!annual2026) throw new Error("The 2026 default folder is missing.");

    const createdFolder = await repository.createFolder(financialActorId, `${runToken}-Folder`);
    expect(createdFolder.status).toBe("saved");
    if (createdFolder.status !== "saved") throw new Error("The integration folder already exists; reset local Supabase.");
    const renamedFolder = await repository.updateFolder({
      folderId: createdFolder.folder.id,
      expectedVersion: createdFolder.folder.version,
      actorProfileId: financialActorId,
      name: `${runToken}-Renamed`,
    });
    expect(renamedFolder).toMatchObject({ status: "saved", folder: { version: 2 } });
    if (renamedFolder.status !== "saved") throw new Error("The integration folder rename failed.");

    const uploaded = await service.uploadRecord({
      actorProfileId: financialActorId,
      fileName: "integration-statement.pdf",
      declaredMimeType: "application/pdf",
      bytes: pdfBytes(),
      record: {
        folderId: annual2026.id,
        displayName: `${runToken} August statement`,
        recordYear: 2026,
        recordMonth: 8,
        description: "Deterministic local integration fixture.",
      },
    });
    expect(uploaded.status).toBe("saved");
    if (uploaded.status !== "saved") throw new Error("The integration record upload failed.");

    const listed = await repository.listRecords({
      q: runToken,
      folderId: annual2026.id,
      year: 2026,
      month: 8,
      status: "active",
      limit: 25,
      offset: 0,
    });
    expect(listed.items).toContainEqual(expect.objectContaining({ id: uploaded.record.id, recordMonth: 8 }));

    const loaded = await service.loadFile(uploaded.record.id);
    expect(loaded?.bytes).toEqual(pdfBytes());

    const moved = await repository.updateRecord({
      recordId: uploaded.record.id,
      expectedVersion: uploaded.record.version,
      actorProfileId: financialActorId,
      record: {
        folderId: renamedFolder.folder.id,
        displayName: `${runToken} renamed statement`,
        recordYear: 2026,
        recordMonth: 9,
        description: "Moved to a custom folder.",
      },
    });
    expect(moved).toMatchObject({ status: "saved", record: { version: 2, recordMonth: 9 } });
    if (moved.status !== "saved") throw new Error("The integration record update failed.");

    await expect(repository.updateRecord({
      recordId: uploaded.record.id,
      expectedVersion: uploaded.record.version,
      actorProfileId: financialActorId,
      record: moved.record,
    })).resolves.toEqual({ status: "conflict", version: moved.record.version });

    const archived = await repository.setRecordArchived({
      recordId: moved.record.id,
      expectedVersion: moved.record.version,
      actorProfileId: financialActorId,
      archived: true,
    });
    expect(archived).toMatchObject({ status: "saved", record: { archivedAt: expect.any(String) } });
    if (archived.status !== "saved") throw new Error("The integration archive failed.");

    const restored = await repository.setRecordArchived({
      recordId: moved.record.id,
      expectedVersion: archived.record.version,
      actorProfileId: financialActorId,
      archived: false,
    });
    expect(restored).toMatchObject({ status: "saved", record: { archivedAt: null } });
    if (restored.status !== "saved") throw new Error("The integration restore failed.");

    await expect(repository.setRecordArchived({
      recordId: moved.record.id,
      expectedVersion: restored.record.version,
      actorProfileId: financialActorId,
      archived: true,
    })).resolves.toMatchObject({ status: "saved", record: { archivedAt: expect.any(String) } });
  }, 30_000);
});
