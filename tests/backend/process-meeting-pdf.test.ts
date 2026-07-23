import { describe, expect, it, vi } from "vitest";
import type { MeetingApprovalRepository } from "../../src/backend/repositories/approvals/meetingApprovalRepository";
import { MinutesPdfStorageError } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import type { MinutesPdfStorage } from "../../src/backend/repositories/storage/minutesPdfStorage";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { approvedSnapshot, meetingId, runId } from "../helpers/meetingApproval";

describe("meeting PDF processor", () => {
  it("claims, renders, stores, and completes one PDF run", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const render = vi.fn().mockResolvedValue({ bytes, pageCount: 2 });
    const alerts = alertServiceMock();
    const processor = createMeetingPdfProcessor({ repository, storage, render, alerts });

    await expect(processor(meetingId)).resolves.toEqual({
      status: "completed",
      meetingId,
      attempt: 1,
      path: `unsigned/${meetingId}/v4/minutes.pdf`,
    });
    expect(storage.storeUnsignedPdf).toHaveBeenCalledWith({
      meetingId,
      documentVersion: 4,
      bytes,
      pageCount: 2,
    });
    expect(repository.completePdfGeneration).toHaveBeenCalledWith(meetingId, runId, expect.objectContaining({
      pageCount: 2,
    }));
    expect(repository.recordPdfFailure).not.toHaveBeenCalled();
    expect(alerts.resolveFailure).toHaveBeenCalledWith({ stage: "PDF_GENERATION", meetingId });
  });

  it("does not generate when the claim is protected or already active", async () => {
    const repository = repositoryMock();
    repository.claimPdfGeneration = vi.fn().mockResolvedValue({
      status: "already_processing",
      meetingId,
      attempt: 1,
    });
    const storage = storageMock();
    const render = vi.fn();

    await expect(createMeetingPdfProcessor({ repository, storage, render })(meetingId)).resolves.toEqual({
      status: "already_processing",
      meetingId,
      attempt: 1,
    });
    expect(render).not.toHaveBeenCalled();
    expect(storage.storeUnsignedPdf).not.toHaveBeenCalled();
  });

  it("records renderer failures and sanitises the result", async () => {
    const repository = repositoryMock();
    const alerts = alertServiceMock();
    const processor = createMeetingPdfProcessor({
      repository,
      storage: storageMock(),
      render: vi.fn().mockRejectedValue(new Error("Renderer could not paginate.")),
      alerts,
    });

    await expect(processor(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "pdf_generation_failed", message: "Renderer could not paginate." },
    });
    expect(repository.recordPdfFailure).toHaveBeenCalledWith(meetingId, runId, {
      code: "pdf_generation_failed",
      message: "Renderer could not paginate.",
    });
    expect(alerts.recordFailure).toHaveBeenCalledWith({
      stage: "PDF_GENERATION",
      meetingId,
      failureCode: "pdf_generation_failed",
      workflowStatus: "PDF_FAILED",
    });
  });

  it("preserves the storage failure code for PDF_FAILED recovery", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    storage.storeUnsignedPdf = vi.fn().mockRejectedValue(new MinutesPdfStorageError(
      "Storage upload failed.",
      { code: "pdf_storage_request_failed" },
    ));
    const processor = createMeetingPdfProcessor({
      repository,
      storage,
      render: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), pageCount: 1 }),
    });

    await expect(processor(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "pdf_storage_request_failed", message: "Storage upload failed." },
    });
  });

  it("rejects stale worker completion without recording another failure", async () => {
    const repository = repositoryMock();
    repository.completePdfGeneration = vi.fn().mockResolvedValue("stale");
    const processor = createMeetingPdfProcessor({
      repository,
      storage: storageMock(),
      render: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), pageCount: 1 }),
    });

    await expect(processor(meetingId)).resolves.toEqual({
      status: "stale",
      meetingId,
      attempt: 1,
    });
    expect(repository.recordPdfFailure).not.toHaveBeenCalled();
  });
});

function repositoryMock(): MeetingApprovalRepository {
  return {
    approve: vi.fn(),
    retryPdf: vi.fn(),
    claimPdfGeneration: vi.fn().mockResolvedValue({
      status: "claimed",
      meetingId,
      runId,
      attempt: 1,
      documentVersion: 4,
      snapshot: approvedSnapshot(),
    }),
    completePdfGeneration: vi.fn().mockResolvedValue("saved"),
    recordPdfFailure: vi.fn().mockResolvedValue("failed"),
  };
}

function storageMock(): MinutesPdfStorage {
  return {
    storeUnsignedPdf: vi.fn().mockResolvedValue({
      path: `unsigned/${meetingId}/v4/minutes.pdf`,
      sha256: "a".repeat(64),
      sizeBytes: 4,
      pageCount: 2,
    }),
  };
}

function alertServiceMock() {
  return {
    recordFailure: vi.fn().mockResolvedValue(undefined),
    resolveFailure: vi.fn().mockResolvedValue(1),
  };
}
