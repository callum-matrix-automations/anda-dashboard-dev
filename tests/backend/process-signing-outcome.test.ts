import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createFirmaSigningClient,
  FirmaSigningClientError,
} from "../../src/backend/integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../src/backend/integrations/signing/signingRequestProvider";
import type { MeetingSigningOutcomeRepository } from "../../src/backend/repositories/signing/meetingSigningOutcomeRepository";
import { createSigningOutcomeProcessor } from "../../src/backend/services/signing/processSigningOutcome";
import type { MeetingSigningOutcomeClaim } from "../../src/shared/contracts/meetingSigning";

const meetingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const eventRecordId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";
const completedAt = "2026-07-20T12:00:00.000Z";
const signedPdf = new TextEncoder().encode("%PDF-1.7\nsigned minutes\n%%EOF");

describe("signing outcome processor", () => {
  it("verifies the expected signer and complete PDF before marking it ready for archive", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });

    await expect(processor.processWebhookEvent("evt_1")).resolves.toEqual({
      status: "ready_for_archive",
      meetingId,
      attempt: 1,
      documentSha256: createHash("sha256").update(signedPdf).digest("hex"),
      documentSizeBytes: signedPdf.byteLength,
    });
    expect(repository.claimWebhook).toHaveBeenCalledWith("evt_1");
    expect(provider.getRequest).toHaveBeenCalledWith("firma-request-1");
    expect(provider.downloadCompletedDocument).toHaveBeenCalledWith("firma-request-1");
    expect(repository.completeOutcome).toHaveBeenCalledWith(claim(), {
      providerStatus: "finished",
      recipientRef: "recipient-1",
      recipientEmail: "treasurer@example.test",
      providerCompletedAt: completedAt,
      signedDocumentSha256: createHash("sha256").update(signedPdf).digest("hex"),
      signedDocumentSizeBytes: signedPdf.byteLength,
    });
  });

  it("supports missed-callback recovery through the same authoritative provider check", async () => {
    const repository = repositoryMock();
    repository.claimReconciliation = vi.fn().mockResolvedValue(claim({ eventId: null, eventRecordId: null }));
    const processor = createSigningOutcomeProcessor({
      repository,
      provider: providerMock(),
      signerEmail: "treasurer@example.test",
    });
    await expect(processor.reconcileMeeting(meetingId)).resolves.toMatchObject({
      status: "ready_for_archive",
    });
    expect(repository.claimReconciliation).toHaveBeenCalledWith(meetingId);
  });

  it("keeps the outcome successful when Firma's completed PDF becomes ready during adapter retries", async () => {
    const repository = repositoryMock();
    const waitImplementation = vi.fn().mockResolvedValue(undefined);
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        id: "firma-request-1",
        status: { sent: true, finished: true, cancelled: false, declined: false, expired: false },
        timestamps: { finished_on: completedAt },
        recipients: [{
          id: "recipient-1",
          email: "treasurer@example.test",
          finished_on: completedAt,
        }],
      }))
      .mockResolvedValueOnce(Response.json(
        { message: "Signing request has not been sent yet" },
        { status: 400 },
      ))
      .mockResolvedValueOnce(Response.json({
        status: "finished",
        is_partial: false,
        download_url: "https://downloads.example.test/signed.pdf",
        generated_at: completedAt,
      }))
      .mockResolvedValueOnce(new Response(signedPdf, {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }));
    const provider = createFirmaSigningClient({
      apiKey: "firma-test-key",
      baseUrl: "https://firma.example.test/functions/v1/signing-request-api/",
      fetchImplementation,
      waitImplementation,
    });
    const processor = createSigningOutcomeProcessor({
      repository,
      provider,
      signerEmail: "treasurer@example.test",
    });

    await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
      status: "ready_for_archive",
    });
    expect(waitImplementation.mock.calls).toEqual([[5_000], [5_000]]);
    expect(repository.completeOutcome).toHaveBeenCalledOnce();
    expect(repository.recordOutcomeFailure).not.toHaveBeenCalled();
  });

  it.each(["not_sent", "sent", "in_progress"])(
    "records %s as no change without downloading a document",
    async (status) => {
      const repository = repositoryMock();
      const provider = providerMock(status);
      const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });
      await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
        status: "no_change",
        providerStatus: status,
      });
      expect(provider.downloadCompletedDocument).not.toHaveBeenCalled();
      expect(repository.completeNoChange).toHaveBeenCalled();
    },
  );

  it.each(["declined", "cancelled", "expired"])(
    "locks terminal provider status %s as a non-retryable failure",
    async (status) => {
      const repository = repositoryMock();
      const processor = createSigningOutcomeProcessor({
        repository,
        provider: providerMock(status),
        signerEmail: "treasurer@example.test",
      });
      await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
        status: "failed",
        retryable: false,
        error: { code: `firma_request_${status}` },
      });
      expect(repository.recordOutcomeFailure).toHaveBeenCalledWith(
        claim(),
        expect.objectContaining({ retryable: false, providerStatus: status }),
      );
    },
  );

  it("rejects a completed request when the configured Treasurer did not sign it", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.getRequest = vi.fn().mockResolvedValue({
      id: "firma-request-1",
      status: "finished",
      recipients: [{ id: "other", email: "other@example.test", finishedAt: completedAt, declinedAt: null }],
      completedAt,
    });
    const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });
    await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
      status: "failed",
      error: { code: "firma_signer_not_completed" },
    });
    expect(provider.downloadCompletedDocument).not.toHaveBeenCalled();
  });

  it("rejects partial and non-PDF downloads", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.downloadCompletedDocument = vi.fn().mockResolvedValue({
      bytes: signedPdf,
      generatedAt: completedAt,
      isPartial: true,
    });
    const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });
    await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
      status: "failed",
      error: { code: "firma_partial_document" },
    });

    repository.claimWebhook = vi.fn().mockResolvedValue(claim());
    provider.downloadCompletedDocument = vi.fn().mockResolvedValue({
      bytes: new TextEncoder().encode("not a PDF"),
      generatedAt: completedAt,
      isPartial: false,
    });
    await expect(processor.processWebhookEvent("evt_2")).resolves.toMatchObject({
      status: "failed",
      error: { code: "firma_invalid_pdf" },
    });
  });

  it("marks transient Firma failures retryable for webhook or Treasurer recovery", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.downloadCompletedDocument = vi.fn().mockRejectedValue(new FirmaSigningClientError(
      "Document is still generating.",
      { code: "firma_document_not_ready", status: 503 },
    ));
    const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });
    await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      error: { code: "firma_document_not_ready" },
    });
  });

  it("does not contact Firma when the durable claim is already complete or stale", async () => {
    const repository = repositoryMock();
    repository.claimWebhook = vi.fn().mockResolvedValue({
      status: "already_completed",
      eventId: "evt_1",
      attempt: 1,
    });
    const provider = providerMock();
    const processor = createSigningOutcomeProcessor({ repository, provider, signerEmail: "treasurer@example.test" });
    await expect(processor.processWebhookEvent("evt_1")).resolves.toMatchObject({
      status: "already_completed",
    });
    expect(provider.getRequest).not.toHaveBeenCalled();
  });
});

function claim(overrides: Partial<Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>> = {}) {
  return {
    status: "claimed" as const,
    eventId: "evt_1",
    eventRecordId,
    meetingId,
    requestId,
    externalRequestId: "firma-request-1",
    documentVersion: 4,
    runId,
    attempt: 1,
    ...overrides,
  };
}

function repositoryMock(): MeetingSigningOutcomeRepository {
  return {
    receiveWebhook: vi.fn(),
    claimWebhook: vi.fn().mockResolvedValue(claim()),
    claimReconciliation: vi.fn().mockResolvedValue(claim({ eventId: null, eventRecordId: null })),
    completeOutcome: vi.fn().mockResolvedValue("saved"),
    completeNoChange: vi.fn().mockResolvedValue("saved"),
    recordOutcomeFailure: vi.fn().mockResolvedValue("failed"),
    getSession: vi.fn(),
    claimRejection: vi.fn(),
    completeRejection: vi.fn(),
    recordRejectionFailure: vi.fn(),
    retryOutcome: vi.fn(),
  };
}

function providerMock(status = "finished"): SigningRequestProvider {
  return {
    findRequest: vi.fn(),
    createRequest: vi.fn(),
    sendRequest: vi.fn(),
    getRequest: vi.fn().mockResolvedValue({
      id: "firma-request-1",
      status,
      recipients: [{
        id: "recipient-1",
        email: "treasurer@example.test",
        finishedAt: status === "finished" ? completedAt : null,
        declinedAt: status === "declined" ? completedAt : null,
      }],
      completedAt: status === "finished" ? completedAt : null,
    }),
    downloadCompletedDocument: vi.fn().mockResolvedValue({
      bytes: signedPdf,
      generatedAt: completedAt,
      isPartial: false,
    }),
    cancelRequest: vi.fn(),
  };
}
