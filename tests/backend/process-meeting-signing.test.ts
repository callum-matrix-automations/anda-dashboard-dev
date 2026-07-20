import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SigningRequestProvider } from "../../src/backend/integrations/signing/signingRequestProvider";
import type { MeetingSigningRepository } from "../../src/backend/repositories/signing/meetingSigningRepository";
import type { ApprovedPdfSource } from "../../src/backend/repositories/storage/approvedPdfSource";
import { createMeetingSigningProcessor } from "../../src/backend/services/signing/processMeetingSigning";
import { TREASURER_SIGNATURE_ANCHOR } from "../../src/backend/services/pdf/renderMinutesPdf";
import type { MeetingSigningClaim } from "../../src/shared/contracts/meetingSigning";
import { meetingId, runId } from "../helpers/meetingApproval";

const pdfId = "33333333-3333-4333-8333-333333333333";
const document = new TextEncoder().encode("%PDF-approved-meeting-minutes");
const recipient = {
  firstName: "Test",
  lastName: "Treasurer",
  email: "treasurer@example.test",
};

describe("meeting signing processor", () => {
  it("loads the immutable PDF, persists the provider reference, sends it, and completes delivery", async () => {
    const repository = repositoryMock();
    const pdfSource = pdfSourceMock();
    const provider = providerMock();
    const processSigning = createMeetingSigningProcessor({ repository, pdfSource, provider, recipient });

    await expect(processSigning(meetingId)).resolves.toEqual({
      status: "completed",
      meetingId,
      attempt: 1,
      externalRequestId: "firma-request-1",
    });
    expect(pdfSource.loadApprovedPdf).toHaveBeenCalledWith(`unsigned/${meetingId}/v4/minutes.pdf`);
    expect(provider.findRequest).toHaveBeenCalledWith(
      `ANDA meeting ${meetingId} v4`,
      recipient.email,
    );
    expect(provider.createRequest).toHaveBeenCalledWith({
      requestName: `ANDA meeting ${meetingId} v4`,
      description: "Approved ANDA meeting minutes, document version 4.",
      document,
      recipient,
      signatureAnchor: TREASURER_SIGNATURE_ANCHOR,
    });
    expect(repository.recordRequestCreated).toHaveBeenCalledWith(
      meetingId,
      runId,
      "firma-request-1",
    );
    expect(provider.sendRequest).toHaveBeenCalledWith("firma-request-1");
    expect(repository.completeDelivery).toHaveBeenCalledWith(meetingId, runId);
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it("reuses the durable external request reference on retry", async () => {
    const repository = repositoryMock(claim({ externalRequestId: "firma-existing" }));
    const provider = providerMock();
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider,
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toMatchObject({
      status: "completed",
      externalRequestId: "firma-existing",
    });
    expect(provider.findRequest).not.toHaveBeenCalled();
    expect(provider.createRequest).not.toHaveBeenCalled();
    expect(repository.recordRequestCreated).not.toHaveBeenCalled();
    expect(provider.sendRequest).toHaveBeenCalledWith("firma-existing");
  });

  it("adopts an existing exact Firma request instead of creating a duplicate", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.findRequest = vi.fn().mockResolvedValue({ id: "firma-reconciled" });
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider,
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toMatchObject({
      status: "completed",
      externalRequestId: "firma-reconciled",
    });
    expect(provider.createRequest).not.toHaveBeenCalled();
    expect(repository.recordRequestCreated).toHaveBeenCalledWith(
      meetingId,
      runId,
      "firma-reconciled",
    );
  });

  it.each(["already_processing", "already_completed", "retry_required", "protected", "not_found"] as const)(
    "does not contact storage or Firma when the claim is %s",
    async (status) => {
      const repository = repositoryMock({ status, meetingId, attempt: status === "not_found" ? null : 1 });
      const pdfSource = pdfSourceMock();
      const provider = providerMock();
      const processSigning = createMeetingSigningProcessor({ repository, pdfSource, provider, recipient });

      await expect(processSigning(meetingId)).resolves.toEqual({
        status,
        meetingId,
        attempt: status === "not_found" ? null : 1,
      });
      expect(pdfSource.loadApprovedPdf).not.toHaveBeenCalled();
      expect(provider.findRequest).not.toHaveBeenCalled();
      expect(provider.createRequest).not.toHaveBeenCalled();
      expect(provider.sendRequest).not.toHaveBeenCalled();
    },
  );

  it("fails safely without contacting Firma when the stored PDF size has changed", async () => {
    const repository = repositoryMock(claim({ pdfSizeBytes: document.byteLength + 1 }));
    const provider = providerMock();
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider,
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: {
        code: "approved_pdf_size_mismatch",
        message: "The stored approved PDF size does not match its immutable record.",
      },
    });
    expect(provider.findRequest).not.toHaveBeenCalled();
    expect(repository.recordFailure).toHaveBeenCalledWith(meetingId, runId, {
      code: "approved_pdf_size_mismatch",
      message: "The stored approved PDF size does not match its immutable record.",
    });
  });

  it("fails safely without contacting Firma when the stored PDF checksum has changed", async () => {
    const repository = repositoryMock(claim({ pdfSha256: "f".repeat(64) }));
    const provider = providerMock();
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider,
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "approved_pdf_checksum_mismatch" },
    });
    expect(provider.createRequest).not.toHaveBeenCalled();
  });

  it("records send failures after the external reference has been saved", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.sendRequest = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider,
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { code: "esign_delivery_failed", message: "provider unavailable" },
    });
    expect(repository.recordRequestCreated).toHaveBeenCalledBefore(repository.recordFailure as ReturnType<typeof vi.fn>);
    expect(repository.recordFailure).toHaveBeenCalledWith(meetingId, runId, {
      code: "esign_delivery_failed",
      message: "provider unavailable",
    });
    expect(repository.completeDelivery).not.toHaveBeenCalled();
  });

  it("does not mark delivery complete when the database claim became stale", async () => {
    const repository = repositoryMock();
    repository.completeDelivery = vi.fn().mockResolvedValue("stale");
    const processSigning = createMeetingSigningProcessor({
      repository,
      pdfSource: pdfSourceMock(),
      provider: providerMock(),
      recipient,
    });

    await expect(processSigning(meetingId)).resolves.toEqual({
      status: "stale",
      meetingId,
      attempt: 1,
    });
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });
});

function claim(overrides: Partial<Extract<MeetingSigningClaim, { status: "claimed" }>> = {}) {
  return {
    status: "claimed" as const,
    meetingId,
    runId,
    attempt: 1,
    pdfId,
    pdfPath: `unsigned/${meetingId}/v4/minutes.pdf`,
    pdfSha256: createHash("sha256").update(document).digest("hex"),
    pdfSizeBytes: document.byteLength,
    documentVersion: 4,
    requestName: `ANDA meeting ${meetingId} v4`,
    externalRequestId: null,
    ...overrides,
  };
}

function repositoryMock(initialClaim: MeetingSigningClaim = claim()): MeetingSigningRepository {
  return {
    claimDelivery: vi.fn().mockResolvedValue(initialClaim),
    recordRequestCreated: vi.fn().mockResolvedValue("saved"),
    completeDelivery: vi.fn().mockResolvedValue("saved"),
    recordFailure: vi.fn().mockResolvedValue("failed"),
    retryDelivery: vi.fn(),
  };
}

function pdfSourceMock(): ApprovedPdfSource {
  return { loadApprovedPdf: vi.fn().mockResolvedValue(document) };
}

function providerMock(): SigningRequestProvider {
  return {
    findRequest: vi.fn().mockResolvedValue(null),
    createRequest: vi.fn().mockResolvedValue({ id: "firma-request-1" }),
    sendRequest: vi.fn().mockResolvedValue(undefined),
    getRequest: vi.fn(),
    downloadCompletedDocument: vi.fn(),
    cancelRequest: vi.fn(),
  };
}
