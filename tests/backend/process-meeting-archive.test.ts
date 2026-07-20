import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SigningRequestProvider } from "../../src/backend/integrations/signing/signingRequestProvider";
import type { MeetingArchiveRepository } from "../../src/backend/repositories/archive/meetingArchiveRepository";
import type { MeetingArchiveStorage } from "../../src/backend/repositories/storage/meetingArchiveStorage";
import { createMeetingArchiveProcessor } from "../../src/backend/services/archive/processMeetingArchive";

const meetingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const pdfId = "44444444-4444-4444-8444-444444444444";
let signedPdf: Uint8Array;

beforeAll(async () => {
  const document = await PDFDocument.create();
  document.addPage([612, 792]);
  signedPdf = await document.save({ useObjectStreams: false });
});

describe("meeting archive processor", () => {
  it("stores the verified signed PDF, removes the unsigned object, and completes the meeting", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const provider = providerMock();
    const process = createMeetingArchiveProcessor({
      repository,
      storage,
      provider,
      retryCount: 0,
    });

    await expect(process(meetingId)).resolves.toEqual({
      status: "completed",
      meetingId,
      attempt: 1,
      signedPdfId: pdfId,
    });
    expect(provider.downloadCompletedDocument).toHaveBeenCalledWith("firma-request-1");
    expect(storage.storeSignedPdf).toHaveBeenCalledWith({
      meetingId,
      documentVersion: 7,
      bytes: signedPdf,
      pageCount: 1,
    });
    expect(storage.removeObject).toHaveBeenCalledWith(`unsigned/${meetingId}/v7/minutes.pdf`);
    expect(repository.complete).toHaveBeenCalledWith({
      meetingId,
      runId,
      storagePath: `signed/${meetingId}/v7/minutes-signed.pdf`,
      sha256: hash(signedPdf),
      sizeBytes: signedPdf.byteLength,
      pageCount: 1,
    });
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it("retries three temporary failures before completing the same archive claim", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    storage.storeSignedPdf = vi.fn()
      .mockRejectedValueOnce(new Error("temporary 1"))
      .mockRejectedValueOnce(new Error("temporary 2"))
      .mockRejectedValueOnce(new Error("temporary 3"))
      .mockResolvedValue(storedPdf());
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const process = createMeetingArchiveProcessor({
      repository,
      storage,
      provider: providerMock(),
      retryCount: 3,
      retryDelayMs: 5_000,
      waitImplementation,
    });

    await expect(process(meetingId)).resolves.toMatchObject({ status: "completed" });
    expect(storage.storeSignedPdf).toHaveBeenCalledTimes(4);
    expect(waitImplementation).toHaveBeenCalledTimes(3);
    expect(waitImplementation).toHaveBeenCalledWith(5_000);
    expect(repository.claim).toHaveBeenCalledTimes(1);
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it("records ARCHIVE_FAILED after all attempts while preserving the verified claim", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    storage.storeSignedPdf = vi.fn().mockRejectedValue(new Error("storage offline"));
    const process = createMeetingArchiveProcessor({
      repository,
      storage,
      provider: providerMock(),
      retryCount: 2,
      retryDelayMs: 0,
      waitImplementation: vi.fn().mockResolvedValue(undefined),
    });

    await expect(process(meetingId)).resolves.toEqual({
      status: "failed",
      meetingId,
      attempt: 1,
      error: { code: "archive_failed", message: "storage offline" },
    });
    expect(storage.storeSignedPdf).toHaveBeenCalledTimes(3);
    expect(storage.removeObject).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(meetingId, runId, {
      code: "archive_failed",
      message: "storage offline",
    });
  });

  it("rejects checksum drift and never stores unverified Firma bytes", async () => {
    const repository = repositoryMock();
    repository.claim = vi.fn().mockResolvedValue({
      ...claim(),
      expectedSha256: "f".repeat(64),
    });
    const storage = storageMock();
    const process = createMeetingArchiveProcessor({
      repository,
      storage,
      provider: providerMock(),
      retryCount: 0,
    });

    await expect(process(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "archive_checksum_mismatch" },
    });
    expect(storage.storeSignedPdf).not.toHaveBeenCalled();
  });

  it("treats duplicate completion and concurrent claims as no-op outcomes", async () => {
    const repository = repositoryMock();
    repository.claim = vi.fn()
      .mockResolvedValueOnce({ status: "already_completed", meetingId, attempt: 1 })
      .mockResolvedValueOnce({ status: "already_processing", meetingId, attempt: 2 });
    const provider = providerMock();
    const process = createMeetingArchiveProcessor({ repository, storage: storageMock(), provider });

    await expect(process(meetingId)).resolves.toMatchObject({ status: "already_completed" });
    await expect(process(meetingId)).resolves.toMatchObject({ status: "already_processing" });
    expect(provider.downloadCompletedDocument).not.toHaveBeenCalled();
  });
});

function claim() {
  return {
    status: "claimed" as const,
    meetingId,
    requestId,
    externalRequestId: "firma-request-1",
    documentVersion: 7,
    runId,
    attempt: 1,
    unsignedPdfPath: `unsigned/${meetingId}/v7/minutes.pdf`,
    expectedSha256: hash(signedPdf),
    expectedSizeBytes: signedPdf.byteLength,
  };
}

function storedPdf() {
  return {
    path: `signed/${meetingId}/v7/minutes-signed.pdf`,
    sha256: hash(signedPdf),
    sizeBytes: signedPdf.byteLength,
    pageCount: 1,
  };
}

function repositoryMock(): MeetingArchiveRepository {
  return {
    claim: vi.fn().mockResolvedValue(claim()),
    complete: vi.fn().mockResolvedValue({
      status: "completed",
      meetingId,
      signedPdfId: pdfId,
      completedAt: "2026-07-20T14:00:00.000Z",
      version: 8,
    }),
    recordFailure: vi.fn().mockResolvedValue({
      status: "failed",
      meetingId,
      attempt: 1,
      version: 8,
    }),
    listRecoveryCandidates: vi.fn().mockResolvedValue([]),
    search: vi.fn(),
    get: vi.fn(),
  };
}

function storageMock(): MeetingArchiveStorage {
  return {
    storeSignedPdf: vi.fn().mockResolvedValue(storedPdf()),
    removeObject: vi.fn().mockResolvedValue(undefined),
    createTemporaryDownload: vi.fn(),
  };
}

function providerMock(): SigningRequestProvider {
  return {
    findRequest: vi.fn(),
    createRequest: vi.fn(),
    sendRequest: vi.fn(),
    getRequest: vi.fn(),
    downloadCompletedDocument: vi.fn().mockResolvedValue({
      bytes: signedPdf,
      generatedAt: "2026-07-20T13:00:00.000Z",
      isPartial: false,
    }),
    cancelRequest: vi.fn(),
  };
}

function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
