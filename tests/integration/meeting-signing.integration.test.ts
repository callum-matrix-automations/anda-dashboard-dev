import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FirmaSigningClientError } from "../../src/backend/integrations/signing/firmaSigningClient";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingArchiveRepository } from "../../src/backend/repositories/supabase/supabaseMeetingArchiveRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingSigningRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningRepository";
import { createSupabaseMeetingSigningOutcomeRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { createSupabaseOperationalAlertRepository } from "../../src/backend/repositories/supabase/supabaseOperationalAlertRepository";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingArchiveService } from "../../src/backend/services/archive/meetingArchiveService";
import { createMeetingArchiveProcessor } from "../../src/backend/services/archive/processMeetingArchive";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { TREASURER_SIGNATURE_ANCHOR } from "../../src/backend/services/pdf/renderMinutesPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createMeetingSigningProcessor } from "../../src/backend/services/signing/processMeetingSigning";
import { createMeetingSigningService } from "../../src/backend/services/signing/retryMeetingSigning";
import { createSigningOutcomeProcessor } from "../../src/backend/services/signing/processSigningOutcome";
import { createRejectMeetingSigningService } from "../../src/backend/services/signing/rejectMeetingSigning";
import { createRetryMeetingSigningOutcomeService } from "../../src/backend/services/signing/retryMeetingSigningOutcome";
import { createStaleSigningReconciliation } from "../../src/backend/services/operations/reconcileStaleMeetingSignings";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
import { FakeSigningProvider, testSigningRecipient } from "../helpers/fakeSigningProvider";
import {
  loadPredefinedMeetingDraft,
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const localIntegrationConfigured = configuration.configured;
const eleanorId = "10000000-0000-4000-8000-000000000001";
const marcusId = "10000000-0000-4000-8000-000000000002";
const priyaId = "10000000-0000-4000-8000-000000000003";

describe.skipIf(!localIntegrationConfigured)("local approved-PDF-to-signing workflow", () => {
  it("routes the exact approved PDF once and advances only after successful delivery", async () => {
    const scenario = await prepareApprovedMeeting("signing-success");
    const provider = new FakeSigningProvider();
    const signing = createSigningProcessor(provider);
    const approval = createMeetingApprovalService({
      repository: scenario.approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: scenario.approvalRepository,
        storage: scenario.storage,
      }),
      processSigning: signing,
    });

    await expect(approval.approveMeeting({
      meetingId: scenario.meetingId,
      expectedVersion: scenario.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    })).resolves.toMatchObject({ status: "approved" });

    const detail = await requiredReview(scenario.meetingId);
    expect(detail).toMatchObject({
      status: "AWAITING_SIGNATURE",
      failure: null,
      pdfArtifact: { id: expect.any(String), sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) },
    });
    expect(provider.created).toHaveLength(1);
    expect(provider.sent).toEqual([provider.created[0]?.id]);
    expect(provider.created[0]).toMatchObject({
      requestName: `ANDA meeting ${scenario.meetingId} v${scenario.version}`,
      recipient: testSigningRecipient,
      signatureAnchor: TREASURER_SIGNATURE_ANCHOR,
    });
    const routedDocument = provider.created[0]?.document;
    if (!routedDocument || !detail.pdfArtifact) throw new Error("The routed PDF was not captured.");
    expect(createHash("sha256").update(routedDocument).digest("hex"))
      .toBe(detail.pdfArtifact.sha256);
    expect(routedDocument.byteLength).toBe(detail.pdfArtifact.sizeBytes);

    const meeting = await loadMeeting(scenario.meetingId);
    expect(meeting).toMatchObject({
      status: "AWAITING_SIGNATURE",
      unsigned_pdf_id: detail.pdfArtifact.id,
      esign_external_ref: provider.created[0]?.id,
      last_error_code: null,
    });
    const request = await loadSigningRequest(scenario.meetingId);
    expect(request).toMatchObject({
      meeting_id: scenario.meetingId,
      pdf_id: detail.pdfArtifact.id,
      document_version: scenario.version,
      provider: "firma",
      external_request_ref: provider.created[0]?.id,
      delivery_status: "DELIVERED",
      attempt: 1,
    });

    await expect(signing(scenario.meetingId)).resolves.toMatchObject({
      status: "already_completed",
    });
    expect(provider.created).toHaveLength(1);
    expect(provider.sent).toHaveLength(1);
    expect(await countSigningRequests(scenario.meetingId)).toBe(1);
    expect(await attemptSigningReferenceReplacement(
      request.id,
      "tampered-provider-reference",
    )).toBe(false);
  }, 30_000);

  it("locks a delivery failure, then retries the same PDF and provider request", async () => {
    const scenario = await prepareApprovedMeeting("signing-retry");
    const provider = new FakeSigningProvider();
    provider.sendFailuresRemaining = 1;
    const signing = createSigningProcessor(provider);
    const approval = createMeetingApprovalService({
      repository: scenario.approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: scenario.approvalRepository,
        storage: scenario.storage,
      }),
      processSigning: signing,
    });

    await approval.approveMeeting({
      meetingId: scenario.meetingId,
      expectedVersion: scenario.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    });
    let detail = await requiredReview(scenario.meetingId);
    expect(detail).toMatchObject({
      status: "ESIGN_FAILED",
      failure: {
        code: "esign_delivery_failed",
        message: "The fake signing provider rejected delivery.",
      },
      pdfArtifact: { id: expect.any(String) },
    });
    const failedPdfId = detail.pdfArtifact?.id;
    const externalRequestId = provider.created[0]?.id;
    if (!externalRequestId) throw new Error("The failed Firma request was not captured.");
    const failedRequest = await loadSigningRequest(scenario.meetingId);
    expect(failedRequest).toMatchObject({
      pdf_id: failedPdfId,
      delivery_status: "FAILED",
      attempt: 1,
      external_request_ref: externalRequestId,
      last_error_code: "esign_delivery_failed",
    });
    await expect(scenario.review.saveMeetingDraft({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      draft: completeDraft(),
    })).resolves.toMatchObject({ status: "protected" });

    const retry = createMeetingSigningService({
      repository: createSupabaseMeetingSigningRepository(configuration),
      processSigning: signing,
    });
    await expect(retry.retryMeetingSigning({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
    })).resolves.toMatchObject({ status: "invalid_actor" });
    await expect(retry.retryMeetingSigning({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: priyaId,
    })).resolves.toMatchObject({
      status: "retry_started",
      pdfId: failedPdfId,
      documentVersion: scenario.version,
    });

    detail = await requiredReview(scenario.meetingId);
    expect(detail).toMatchObject({
      status: "AWAITING_SIGNATURE",
      failure: null,
      pdfArtifact: { id: failedPdfId },
    });
    expect(provider.created).toHaveLength(1);
    expect(provider.sent).toEqual([externalRequestId, externalRequestId]);
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      pdf_id: failedPdfId,
      external_request_ref: externalRequestId,
      delivery_status: "DELIVERED",
      attempt: 2,
      last_error_code: null,
      last_error_message: null,
    });
    expect(await countSigningRequests(scenario.meetingId)).toBe(1);
    expect(detail.history.map((entry) => entry.action)).toContain("ESIGN_RETRY");
  }, 30_000);

  it("keeps PDF_PROCESSING out of AWAITING_SIGNATURE when provider creation fails", async () => {
    const scenario = await prepareApprovedMeeting("signing-create-failure");
    const provider = new FakeSigningProvider();
    provider.createFailuresRemaining = 1;
    const approval = createMeetingApprovalService({
      repository: scenario.approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: scenario.approvalRepository,
        storage: scenario.storage,
      }),
      processSigning: createSigningProcessor(provider),
    });

    await approval.approveMeeting({
      meetingId: scenario.meetingId,
      expectedVersion: scenario.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    });
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "ESIGN_FAILED",
      esign_external_ref: null,
      last_error_code: "esign_delivery_failed",
    });
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      delivery_status: "FAILED",
      external_request_ref: null,
      attempt: 1,
    });
    expect(provider.sent).toHaveLength(0);
  }, 30_000);

  it("serialises concurrent delivery claims so only one provider request is created", async () => {
    const scenario = await prepareApprovedMeeting("signing-concurrent");
    const provider = new FakeSigningProvider();
    const signing = createSigningProcessor(provider);
    const approval = createMeetingApprovalService({
      repository: scenario.approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: scenario.approvalRepository,
        storage: scenario.storage,
      }),
      processSigning: vi.fn().mockResolvedValue({
        status: "protected",
        meetingId: scenario.meetingId,
        attempt: null,
      }),
    });
    await approval.approveMeeting({
      meetingId: scenario.meetingId,
      expectedVersion: scenario.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    });
    expect((await requiredReview(scenario.meetingId)).status).toBe("PDF_PROCESSING");

    const results = await Promise.all([
      signing(scenario.meetingId),
      signing(scenario.meetingId),
    ]);
    expect(results.map((result) => result.status)).toContain("completed");
    expect(results.map((result) => result.status)).toEqual(expect.arrayContaining([
      expect.stringMatching(/already_processing|already_completed/u),
    ]));
    expect(provider.created).toHaveLength(1);
    expect(provider.sent).toHaveLength(1);
    expect(await countSigningRequests(scenario.meetingId)).toBe(1);
    expect((await requiredReview(scenario.meetingId)).status).toBe("AWAITING_SIGNATURE");
  }, 30_000);

  it("processes one authenticated webhook event idempotently and leaves archiving to ANDA-009", async () => {
    const scenario = await prepareAwaitingSigning("signing-outcome-webhook");
    const outcomeRepository = createSupabaseMeetingSigningOutcomeRepository(configuration);
    scenario.provider.requestStatus = "finished";
    scenario.provider.completedAt = "2026-07-20T12:00:00.000Z";
    const externalRequestId = scenario.provider.created[0]?.id;
    if (!externalRequestId) throw new Error("The Firma request was not created.");
    const recipientSignedEvent = {
      id: `evt_recipient_signed_${scenario.meetingId}`,
      type: "signing_request.recipient.signed",
      data: { signing_request: { id: externalRequestId } },
    };
    const event = {
      id: `evt_${scenario.meetingId}`,
      type: "signing_request.completed",
      data: { signing_request: { id: externalRequestId } },
    };
    const recipientSignedPayloadHash = createHash("sha256")
      .update(JSON.stringify(recipientSignedEvent))
      .digest("hex");
    const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    const processor = createSigningOutcomeProcessor({
      repository: outcomeRepository,
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });

    await expect(outcomeRepository.receiveWebhook(
      recipientSignedEvent,
      externalRequestId,
      recipientSignedPayloadHash,
    )).resolves.toMatchObject({ status: "ignored", meetingId: scenario.meetingId });
    await expect(processor.processWebhookEvent(recipientSignedEvent.id)).resolves.toMatchObject({
      status: "already_completed",
    });
    expect(await loadWebhookEvent(recipientSignedEvent.id)).toMatchObject({
      event_type: "signing_request.recipient.signed",
      processing_status: "IGNORED",
      attempt: 0,
    });
    await expect(outcomeRepository.receiveWebhook(event, externalRequestId, payloadHash))
      .resolves.toMatchObject({ status: "accepted", meetingId: scenario.meetingId });
    await expect(processor.processWebhookEvent(event.id)).resolves.toMatchObject({
      status: "ready_for_archive",
      meetingId: scenario.meetingId,
      documentSha256: createHash("sha256").update(scenario.provider.signedDocument).digest("hex"),
    });

    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "AWAITING_SIGNATURE",
      signed_by: priyaId,
      signed_at: "2026-07-20T12:00:00+00:00",
      signed_pdf_path: null,
    });
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      outcome_status: "READY_FOR_ARCHIVE",
      provider_status: "finished",
      recipient_email: testSigningRecipient.email,
      signed_document_sha256: createHash("sha256").update(scenario.provider.signedDocument).digest("hex"),
      signed_document_size_bytes: scenario.provider.signedDocument.byteLength,
    });
    expect((await requiredReview(scenario.meetingId)).history.map((entry) => entry.action))
      .toContain("SIGNED");

    await expect(outcomeRepository.receiveWebhook(event, externalRequestId, payloadHash))
      .resolves.toMatchObject({ status: "duplicate" });
    await expect(processor.processWebhookEvent(event.id)).resolves.toMatchObject({
      status: "already_completed",
    });
  }, 30_000);

  it("recovers a completed signing request when its webhook was missed", async () => {
    const scenario = await prepareAwaitingSigning("signing-outcome-reconcile");
    await ageSigningRequest(scenario.meetingId);
    scenario.provider.requestStatus = "finished";
    scenario.provider.completedAt = "2026-07-20T12:15:00.000Z";
    const processor = createSigningOutcomeProcessor({
      repository: createSupabaseMeetingSigningOutcomeRepository(configuration),
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });
    const reconcile = createStaleSigningReconciliation({
      repository: createSupabaseOperationalAlertRepository(configuration),
      processClaim: processor.processClaim,
      alerts: { recordFailure: vi.fn(), resolveFailure: vi.fn().mockResolvedValue(0) },
    });
    const overlappingRuns = await Promise.all([
      reconcile({ ageMinutes: 10, limit: 25, maxAttempts: 5 }),
      reconcile({ ageMinutes: 10, limit: 25, maxAttempts: 5 }),
    ]);
    const recoveredTarget = overlappingRuns
      .flatMap((run) => run.results)
      .filter((result) => result.meetingId === scenario.meetingId);
    expect(recoveredTarget).toEqual([
      expect.objectContaining({ status: "ready_for_archive", meetingId: scenario.meetingId }),
    ]);
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      outcome_status: "READY_FOR_ARCHIVE",
      outcome_attempt: 1,
    });
  }, 30_000);

  it("archives the verified signed PDF, removes the temporary object, and exposes searchable private access", async () => {
    const scenario = await prepareAwaitingSigning("archive-success");
    const unsignedArtifact = (await requiredReview(scenario.meetingId)).pdfArtifact;
    const routedDocument = scenario.provider.created[0]?.document;
    if (!unsignedArtifact || !routedDocument) throw new Error("The unsigned PDF was not routed.");
    scenario.provider.signedDocument = new Uint8Array(routedDocument);
    scenario.provider.requestStatus = "finished";
    scenario.provider.completedAt = "2026-07-20T13:00:00.000Z";
    const outcome = createSigningOutcomeProcessor({
      repository: createSupabaseMeetingSigningOutcomeRepository(configuration),
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });
    await expect(outcome.reconcileMeeting(scenario.meetingId)).resolves.toMatchObject({
      status: "ready_for_archive",
    });

    const archiveRepository = createSupabaseMeetingArchiveRepository(configuration);
    const archiveStorage = createSupabaseMinutesPdfStorage(configuration);
    const archive = createMeetingArchiveProcessor({
      repository: archiveRepository,
      storage: archiveStorage,
      provider: scenario.provider,
      retryCount: 0,
    });
    await expect(archive(scenario.meetingId)).resolves.toMatchObject({
      status: "completed",
      meetingId: scenario.meetingId,
      signedPdfId: expect.any(String),
    });

    const meeting = await loadMeeting(scenario.meetingId);
    expect(meeting).toMatchObject({
      status: "COMPLETED",
      unsigned_pdf_id: null,
      signed_pdf_id: expect.any(String),
      signed_pdf_path: `signed/${scenario.meetingId}/v${scenario.version}/minutes-signed.pdf`,
      completed_at: expect.any(String),
      last_error_code: null,
    });
    const pdfs = await selectRows<{
      id: string;
      pdf_type: string;
      storage_path: string;
      sha256: string;
    }>("meeting_pdfs", "meeting_id", scenario.meetingId, "id,pdf_type,storage_path,sha256");
    expect(pdfs.map((pdf) => pdf.pdf_type)).toEqual(expect.arrayContaining(["UNSIGNED", "SIGNED"]));
    expect(pdfs.find((pdf) => pdf.pdf_type === "SIGNED")).toMatchObject({
      id: meeting.signed_pdf_id,
      storage_path: meeting.signed_pdf_path,
      sha256: createHash("sha256").update(scenario.provider.signedDocument).digest("hex"),
    });
    await expect(archiveStorage.loadApprovedPdf(unsignedArtifact.path)).rejects.toMatchObject({
      code: "pdf_storage_download_failed",
    });

    const readService = createMeetingArchiveService({
      repository: archiveRepository,
      storage: archiveStorage,
      signedUrlSeconds: 60,
    });
    await expect(readService.search({
      query: "Adopt",
      year: 2026,
      category: "Board Meeting",
      limit: 100,
      offset: 0,
    })).resolves.toMatchObject({
      total: expect.any(Number),
      items: expect.arrayContaining([expect.objectContaining({ meetingId: scenario.meetingId })]),
    });
    await expect(readService.search({
      query: "Hartwell",
      year: 2026,
      category: "Board Meeting",
      limit: 100,
      offset: 0,
    })).resolves.toMatchObject({ total: 0, items: [] });
    const access = await readService.createDocumentAccess(scenario.meetingId);
    expect(access).toMatchObject({
      status: "available",
      access: { url: expect.stringContaining("/storage/v1/object/sign/") },
    });
    if (access.status !== "available") throw new Error("Signed PDF access was not created.");
    const download = await fetch(access.access.url);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(scenario.provider.signedDocument);

    await expect(archive(scenario.meetingId)).resolves.toMatchObject({ status: "already_completed" });
    expect(await attemptMeetingTitleReplacement(scenario.meetingId)).toBe(false);
    expect(await attemptCompletedPdfInsert(scenario.meetingId)).toBe(false);
  }, 30_000);

  it("preserves signature evidence through ARCHIVE_FAILED and recovers without re-signing", async () => {
    const scenario = await prepareAwaitingSigning("archive-recovery");
    const routedDocument = scenario.provider.created[0]?.document;
    if (!routedDocument) throw new Error("The unsigned PDF was not routed.");
    scenario.provider.signedDocument = new Uint8Array(routedDocument);
    scenario.provider.requestStatus = "finished";
    scenario.provider.completedAt = "2026-07-20T13:30:00.000Z";
    await createSigningOutcomeProcessor({
      repository: createSupabaseMeetingSigningOutcomeRepository(configuration),
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    }).reconcileMeeting(scenario.meetingId);

    const repository = createSupabaseMeetingArchiveRepository(configuration);
    const realStorage = createSupabaseMinutesPdfStorage(configuration);
    const failedArchive = createMeetingArchiveProcessor({
      repository,
      provider: scenario.provider,
      storage: {
        ...realStorage,
        storeSignedPdf: vi.fn().mockRejectedValue(new Error("Archive storage unavailable.")),
      },
      retryCount: 0,
    });
    await expect(failedArchive(scenario.meetingId)).resolves.toMatchObject({
      status: "failed",
      error: { message: "Archive storage unavailable." },
    });
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "ARCHIVE_FAILED",
      signed_by: priyaId,
      signed_at: "2026-07-20T13:30:00+00:00",
      signed_pdf_id: null,
      signed_pdf_path: null,
      last_error_code: "archive_failed",
    });
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      outcome_status: "READY_FOR_ARCHIVE",
      signed_document_sha256: createHash("sha256").update(scenario.provider.signedDocument).digest("hex"),
    });
    await expect(repository.listRecoveryCandidates(100, 1)).resolves.not.toContain(scenario.meetingId);
    await expect(repository.listRecoveryCandidates(100, 3)).resolves.toContain(scenario.meetingId);

    await expect(createMeetingArchiveProcessor({
      repository,
      storage: realStorage,
      provider: scenario.provider,
      retryCount: 0,
    })(scenario.meetingId)).resolves.toMatchObject({ status: "completed" });
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "COMPLETED",
      signed_pdf_id: expect.any(String),
      last_error_code: null,
    });
    expect(scenario.provider.created).toHaveLength(1);
    expect(scenario.provider.sent).toHaveLength(1);
  }, 30_000);

  it("retries the same webhook event after a transient signed-PDF download failure", async () => {
    const scenario = await prepareAwaitingSigning("signing-outcome-webhook-retry");
    const outcomeRepository = createSupabaseMeetingSigningOutcomeRepository(configuration);
    scenario.provider.requestStatus = "finished";
    scenario.provider.completedAt = "2026-07-20T12:30:00.000Z";
    const externalRequestId = scenario.provider.created[0]?.id;
    if (!externalRequestId) throw new Error("The Firma request was not created.");
    const event = {
      id: `evt_retry_${scenario.meetingId}`,
      type: "signing_request.completed",
      data: { signing_request: { id: externalRequestId } },
    };
    const payloadHash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    await outcomeRepository.receiveWebhook(event, externalRequestId, payloadHash);
    scenario.provider.downloadCompletedDocument = vi.fn().mockRejectedValueOnce(
      new FirmaSigningClientError("The signed PDF is still generating.", {
        status: 503,
        code: "firma_document_not_ready",
      }),
    );
    const processor = createSigningOutcomeProcessor({
      repository: outcomeRepository,
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });

    await expect(processor.processWebhookEvent(event.id)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
      error: { code: "firma_document_not_ready" },
    });
    expect(await loadWebhookEvent(event.id)).toMatchObject({ processing_status: "FAILED" });
    await expect(outcomeRepository.receiveWebhook(event, externalRequestId, payloadHash))
      .resolves.toMatchObject({ status: "retry" });

    scenario.provider.downloadCompletedDocument = vi.fn().mockResolvedValue({
      bytes: new Uint8Array(scenario.provider.signedDocument),
      generatedAt: scenario.provider.completedAt,
      isPartial: false,
    });
    await expect(processor.processWebhookEvent(event.id)).resolves.toMatchObject({
      status: "ready_for_archive",
      attempt: 2,
    });
    expect(await loadWebhookEvent(event.id)).toMatchObject({ processing_status: "PROCESSED" });
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "AWAITING_SIGNATURE",
      last_error_code: null,
    });
  }, 30_000);

  it("rejects with a mandatory comment, preserves history, and creates a new version on reapproval", async () => {
    const scenario = await prepareAwaitingSigning("signing-rejection");
    const outcomeRepository = createSupabaseMeetingSigningOutcomeRepository(configuration);
    const reject = createRejectMeetingSigningService({
      repository: outcomeRepository,
      provider: scenario.provider,
    });
    let detail = await requiredReview(scenario.meetingId);
    const oldPdfId = detail.pdfArtifact?.id;
    const oldRequest = await loadSigningRequest(scenario.meetingId);

    await expect(reject({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      comment: "Correct the vote record.",
    })).resolves.toMatchObject({ status: "invalid_actor" });
    await expect(reject({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: priyaId,
      comment: "Correct the vote record.",
    })).resolves.toMatchObject({ status: "rejected" });

    expect(scenario.provider.cancelled).toEqual([{
      id: oldRequest.external_request_ref,
      reason: "Correct the vote record.",
    }]);
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "PENDING_APPROVAL",
      approved_by: null,
      approved_at: null,
      approved_snapshot: null,
      unsigned_pdf_id: null,
      esign_external_ref: null,
      human_owned: true,
    });
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      id: oldRequest.id,
      pdf_id: oldPdfId,
      outcome_status: "REJECTED",
      rejection_comment: "Correct the vote record.",
      rejected_by: priyaId,
    });
    detail = await requiredReview(scenario.meetingId);
    expect(detail.history).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "TREASURER_REJECTED",
        note: "Correct the vote record.",
      }),
    ]));

    const edited = completeDraft();
    edited.minutes.summary = "The Treasurer correction was applied before reapproval.";
    const saved = await scenario.review.saveMeetingDraft({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      draft: edited,
    });
    if (saved.version === null) throw new Error("The corrected draft was not saved.");
    scenario.provider.requestStatus = "in_progress";
    await createMeetingApprovalService({
      repository: scenario.approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: scenario.approvalRepository,
        storage: scenario.storage,
      }),
      processSigning: createSigningProcessor(scenario.provider),
    }).approveMeeting({
      meetingId: scenario.meetingId,
      expectedVersion: saved.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    });

    const requests = await loadSigningRequests(scenario.meetingId);
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((request) => request.pdf_id)).size).toBe(2);
    expect(requests.map((request) => request.document_version)).toEqual(expect.arrayContaining([
      oldRequest.document_version,
      saved.version,
    ]));
    expect((await requiredReview(scenario.meetingId)).status).toBe("AWAITING_SIGNATURE");

    const staleEvent = {
      id: `evt_stale_${scenario.meetingId}`,
      type: "signing_request.completed",
      data: { signing_request: { id: oldRequest.external_request_ref } },
    };
    await outcomeRepository.receiveWebhook(
      staleEvent,
      oldRequest.external_request_ref,
      createHash("sha256").update(JSON.stringify(staleEvent)).digest("hex"),
    );
    const staleProcessor = createSigningOutcomeProcessor({
      repository: outcomeRepository,
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });
    await expect(staleProcessor.processWebhookEvent(staleEvent.id)).resolves.toMatchObject({
      status: "stale",
    });
    expect(await loadWebhookEvent(staleEvent.id)).toMatchObject({
      processing_status: "IGNORED",
      signing_request_id: oldRequest.id,
    });
  }, 30_000);

  it("keeps approval locked when Firma cancellation fails and safely retries the rejection", async () => {
    const scenario = await prepareAwaitingSigning("signing-rejection-retry");
    const outcomeRepository = createSupabaseMeetingSigningOutcomeRepository(configuration);
    const reject = createRejectMeetingSigningService({
      repository: outcomeRepository,
      provider: scenario.provider,
    });
    scenario.provider.cancelFailuresRemaining = 1;
    let detail = await requiredReview(scenario.meetingId);
    await expect(reject({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: priyaId,
      comment: "Correct the attendee list.",
    })).resolves.toMatchObject({ status: "failed" });
    expect(await loadMeeting(scenario.meetingId)).toMatchObject({
      status: "ESIGN_FAILED",
      approved_by: expect.any(String),
      approved_snapshot: expect.any(Object),
      unsigned_pdf_id: expect.any(String),
    });
    expect(await loadSigningRequest(scenario.meetingId)).toMatchObject({
      outcome_status: "REJECTION_FAILED",
      rejection_comment: "Correct the attendee list.",
      rejected_by: priyaId,
      last_error_code: "esign_rejection_failed",
    });

    detail = await requiredReview(scenario.meetingId);
    await expect(reject({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: priyaId,
      comment: "Correct the attendee list.",
    })).resolves.toMatchObject({ status: "rejected" });
    expect((await requiredReview(scenario.meetingId)).status).toBe("PENDING_APPROVAL");
  }, 30_000);

  it("locks a terminal signing failure and authorises only the Treasurer to retry reconciliation", async () => {
    const scenario = await prepareAwaitingSigning("signing-outcome-retry");
    const outcomeRepository = createSupabaseMeetingSigningOutcomeRepository(configuration);
    scenario.provider.requestStatus = "expired";
    const processor = createSigningOutcomeProcessor({
      repository: outcomeRepository,
      provider: scenario.provider,
      signerEmail: testSigningRecipient.email,
    });
    await expect(processor.reconcileMeeting(scenario.meetingId)).resolves.toMatchObject({
      status: "failed",
      retryable: false,
      error: { code: "firma_request_expired" },
    });
    let detail = await requiredReview(scenario.meetingId);
    expect(detail.status).toBe("ESIGN_FAILED");

    const retry = createRetryMeetingSigningOutcomeService({
      repository: outcomeRepository,
      reconcile: processor.reconcileMeeting,
    });
    await expect(retry({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
    })).resolves.toMatchObject({ status: "invalid_actor" });

    scenario.provider.requestStatus = "in_progress";
    await expect(retry({
      meetingId: scenario.meetingId,
      expectedVersion: detail.version,
      actorProfileId: priyaId,
    })).resolves.toMatchObject({
      status: "retry_started",
      reconciliation: { status: "no_change", providerStatus: "in_progress" },
    });
    detail = await requiredReview(scenario.meetingId);
    expect(detail).toMatchObject({ status: "AWAITING_SIGNATURE", failure: null });
    expect(detail.history.map((entry) => entry.action)).toContain("ESIGN_RETRY");
  }, 30_000);
});

async function prepareAwaitingSigning(idPrefix: string) {
  const scenario = await prepareApprovedMeeting(idPrefix);
  const provider = new FakeSigningProvider();
  const approval = createMeetingApprovalService({
    repository: scenario.approvalRepository,
    processPdf: createMeetingPdfProcessor({
      repository: scenario.approvalRepository,
      storage: scenario.storage,
    }),
    processSigning: createSigningProcessor(provider),
  });
  await approval.approveMeeting({
    meetingId: scenario.meetingId,
    expectedVersion: scenario.version,
    actorProfileId: eleanorId,
    acknowledgeUnresolvedVotes: false,
  });
  return { ...scenario, provider };
}

async function prepareApprovedMeeting(idPrefix: string) {
  const draft = await loadPredefinedMeetingDraft();
  const workflow = await runPreApprovalWorkflow({
    analyze: vi.fn().mockResolvedValue(draft),
    idPrefix,
  });
  const meetingId = workflow.meetings[0]?.id;
  if (!meetingId) throw new Error("The workflow did not create a meeting.");
  const review = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
  const detail = await requiredReview(meetingId);
  const saved = await review.saveMeetingDraft({
    meetingId,
    expectedVersion: detail.version,
    actorProfileId: eleanorId,
    draft: completeDraft(),
  });
  if (saved.version === null) throw new Error("The completed meeting draft was not saved.");
  return {
    meetingId,
    version: saved.version,
    review,
    approvalRepository: createSupabaseMeetingApprovalRepository(configuration),
    storage: createSupabaseMinutesPdfStorage(configuration),
  };
}

function createSigningProcessor(provider: FakeSigningProvider) {
  return createMeetingSigningProcessor({
    repository: createSupabaseMeetingSigningRepository(configuration),
    pdfSource: createSupabaseMinutesPdfStorage(configuration),
    provider,
    recipient: testSigningRecipient,
  });
}

function completeDraft(): MeetingReviewDraft {
  return {
    minutes: {
      summary: "The officer reviewed and completed the meeting record.",
      sections: [
        { heading: "Governance", content: "The board approved the revised governance policy." },
        { heading: "Finance", content: "The board reviewed the current financial position." },
      ],
    },
    attendeeProfileIds: [eleanorId, marcusId, priyaId],
    motions: [{
      text: "Adopt the revised governance policy.",
      moverProfileId: eleanorId,
      seconderProfileId: marcusId,
      outcome: "carried",
      votes: [
        { profileId: eleanorId, selection: "for" },
        { profileId: marcusId, selection: "against" },
        { profileId: priyaId, selection: "abstain" },
      ],
    }],
    tags: ["approved", "governance"],
  };
}

async function requiredReview(meetingId: string) {
  const service = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
  const detail = await service.getMeetingReview(meetingId);
  if (!detail) throw new Error(`Meeting ${meetingId} was not found.`);
  return detail;
}

async function loadMeeting(meetingId: string) {
  return requiredRow<{
    status: string;
    unsigned_pdf_id: string | null;
    esign_external_ref: string | null;
    last_error_code: string | null;
    signed_by: string | null;
    signed_at: string | null;
    signed_pdf_path: string | null;
    signed_pdf_id: string | null;
    completed_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
    approved_snapshot: unknown;
    human_owned: boolean;
  }>(
    "meetings",
    "id",
    meetingId,
    "status,unsigned_pdf_id,esign_external_ref,last_error_code,signed_by,signed_at,signed_pdf_path,signed_pdf_id,completed_at,approved_by,approved_at,approved_snapshot,human_owned",
  );
}

async function loadSigningRequest(meetingId: string) {
  return requiredRow<{
    id: string;
    meeting_id: string;
    pdf_id: string;
    document_version: number;
    provider: string;
    external_request_ref: string | null;
    delivery_status: string;
    attempt: number;
    outcome_status: string;
    outcome_attempt: number;
    provider_status: string | null;
    recipient_email: string | null;
    signed_document_sha256: string | null;
    signed_document_size_bytes: number | null;
    rejection_comment: string | null;
    rejected_by: string | null;
    last_error_code: string | null;
    last_error_message: string | null;
  }>(
    "meeting_signing_requests",
    "meeting_id",
    meetingId,
    "id,meeting_id,pdf_id,document_version,provider,external_request_ref,delivery_status,attempt,outcome_status,outcome_attempt,provider_status,recipient_email,signed_document_sha256,signed_document_size_bytes,rejection_comment,rejected_by,last_error_code,last_error_message",
  );
}

async function ageSigningRequest(meetingId: string) {
  const url = new URL("/rest/v1/meeting_signing_requests", configuration.apiUrl);
  url.searchParams.set("meeting_id", `eq.${meetingId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      apikey: configuration.secretKey,
      authorization: `Bearer ${configuration.secretKey}`,
      prefer: "return=minimal",
    },
    body: JSON.stringify({ sent_at: "2026-07-19T12:00:00.000Z" }),
  });
  if (!response.ok) throw new Error(`Could not age signing request: ${await response.text()}`);
}

async function loadSigningRequests(meetingId: string) {
  return selectRows<{
    id: string;
    pdf_id: string;
    document_version: number;
    outcome_status: string;
  }>("meeting_signing_requests", "meeting_id", meetingId, "id,pdf_id,document_version,outcome_status");
}

async function loadWebhookEvent(eventId: string) {
  return requiredRow<{
    event_type: string;
    processing_status: string;
    attempt: number;
    signing_request_id: string | null;
  }>(
    "signing_webhook_events",
    "provider_event_id",
    eventId,
    "event_type,processing_status,attempt,signing_request_id",
  );
}

async function countSigningRequests(meetingId: string): Promise<number> {
  const rows = await selectRows<Record<string, never>>("meeting_signing_requests", "meeting_id", meetingId, "id");
  return rows.length;
}

async function requiredRow<T>(table: string, column: string, value: string, select: string): Promise<T> {
  const rows = await selectRows<T>(table, column, value, select);
  const row = rows[0];
  if (!row) throw new Error(`No ${table} row was found for ${column}=${value}.`);
  return row;
}

async function selectRows<T>(table: string, column: string, value: string, select: string): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, configuration.apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`${table} query failed with HTTP ${response.status}.`);
  return response.json() as Promise<T[]>;
}

function serviceHeaders() {
  return {
    apikey: configuration.secretKey,
    authorization: `Bearer ${configuration.secretKey}`,
  };
}

async function attemptSigningReferenceReplacement(requestId: string, replacement: string) {
  const url = new URL("/rest/v1/meeting_signing_requests", configuration.apiUrl);
  url.searchParams.set("id", `eq.${requestId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ external_request_ref: replacement }),
  });
  return response.ok;
}

async function attemptMeetingTitleReplacement(meetingId: string) {
  const url = new URL("/rest/v1/meetings", configuration.apiUrl);
  url.searchParams.set("id", `eq.${meetingId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ title: "Tampered completed meeting" }),
  });
  return response.ok;
}

async function attemptCompletedPdfInsert(meetingId: string) {
  const response = await fetch(new URL("/rest/v1/meeting_pdfs", configuration.apiUrl), {
    method: "POST",
    headers: { ...serviceHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({
      meeting_id: meetingId,
      pdf_type: "SIGNED",
      document_version: 999,
      storage_path: `signed/${meetingId}/tampered.pdf`,
      sha256: "f".repeat(64),
      size_bytes: 100,
      page_count: 1,
    }),
  });
  return response.ok;
}
