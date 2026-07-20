import { describe, expect, it, vi } from "vitest";
import { createFirmaArchiveWorkflow } from "../../src/backend/services/archive/processFirmaArchiveWorkflow";

const meetingId = "11111111-1111-4111-8111-111111111111";

describe("Firma-to-archive workflow", () => {
  it("calls the separate archive service only after verified signing completion", async () => {
    const processSigning = vi.fn().mockResolvedValue({
      status: "ready_for_archive",
      meetingId,
      attempt: 1,
      documentSha256: "a".repeat(64),
      documentSizeBytes: 100,
    });
    const processArchive = vi.fn().mockResolvedValue({
      status: "completed",
      meetingId,
      attempt: 1,
      signedPdfId: "22222222-2222-4222-8222-222222222222",
    });
    const workflow = createFirmaArchiveWorkflow({ processSigning, processArchive });

    await expect(workflow("evt-1")).resolves.toMatchObject({
      signing: { status: "ready_for_archive" },
      archive: { status: "completed" },
    });
    expect(processArchive).toHaveBeenCalledWith(meetingId);
  });

  it("does not archive incomplete or failed signing outcomes", async () => {
    const processSigning = vi.fn().mockResolvedValue({
      status: "failed",
      meetingId,
      attempt: 1,
      error: { code: "firma_failed", message: "Failed" },
      retryable: true,
    });
    const processArchive = vi.fn();
    const workflow = createFirmaArchiveWorkflow({ processSigning, processArchive });

    await expect(workflow("evt-1")).resolves.toMatchObject({ archive: null });
    expect(processArchive).not.toHaveBeenCalled();
  });
});
