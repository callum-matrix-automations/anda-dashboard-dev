import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingSigningRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { TREASURER_SIGNATURE_ANCHOR } from "../../src/backend/services/pdf/renderMinutesPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createMeetingSigningProcessor } from "../../src/backend/services/signing/processMeetingSigning";
import { createMeetingSigningService } from "../../src/backend/services/signing/retryMeetingSigning";
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
});

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
  }>("meetings", "id", meetingId, "status,unsigned_pdf_id,esign_external_ref,last_error_code");
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
    last_error_code: string | null;
    last_error_message: string | null;
  }>(
    "meeting_signing_requests",
    "meeting_id",
    meetingId,
    "id,meeting_id,pdf_id,document_version,provider,external_request_ref,delivery_status,attempt,last_error_code,last_error_message",
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
