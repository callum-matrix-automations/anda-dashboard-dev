import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingSigningRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createMeetingSigningProcessor } from "../../src/backend/services/signing/processMeetingSigning";
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

describe.skipIf(!localIntegrationConfigured)("local approval-to-PDF workflow", () => {
  it("validates, acknowledges, locks, renders, associates, and stores approved minutes", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const workflow = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      idPrefix: "approval-pdf-success",
    });
    const meetingId = requiredMeetingId(workflow.meetings[0]?.id);
    const review = reviewService();
    const approvalRepository = createSupabaseMeetingApprovalRepository(configuration);
    const processor = createMeetingPdfProcessor({
      repository: approvalRepository,
      storage: createSupabaseMinutesPdfStorage(configuration),
    });
    const processPdf = vi.fn(processor);
    const processSigning = signingProcessor(new FakeSigningProvider());
    const approvalService = createMeetingApprovalService({
      repository: approvalRepository,
      processPdf,
      processSigning,
    });
    let detail = await requiredReview(review, meetingId);

    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: detail.version,
      actorProfileId: "99999999-9999-4999-8999-999999999999",
      acknowledgeUnresolvedVotes: false,
    })).resolves.toMatchObject({ status: "invalid_actor" });

    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    })).resolves.toMatchObject({ status: "invalid_content" });

    const saved = await review.saveMeetingDraft({
      meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      draft: completeDraft(true),
    });
    const savedVersion = requiredVersion(saved.version);
    const deferred = await review.deferMeetingReview({
      meetingId,
      expectedVersion: savedVersion,
      actorProfileId: eleanorId,
      note: "Confirm the final supporting paper.",
    });
    const deferredVersion = requiredVersion(deferred.version);

    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: deferredVersion,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    })).resolves.toMatchObject({ status: "deferred" });

    const resumed = await review.resumeMeetingReview({
      meetingId,
      expectedVersion: deferredVersion,
      actorProfileId: eleanorId,
    });
    const currentVersion = requiredVersion(resumed.version);
    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: deferredVersion,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    })).resolves.toMatchObject({ status: "conflict", version: currentVersion });

    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: currentVersion,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    })).resolves.toMatchObject({
      status: "acknowledgement_required",
      unresolvedVoteCount: 1,
    });
    expect(processPdf).not.toHaveBeenCalled();

    const approval = await approvalService.approveMeeting({
      meetingId,
      expectedVersion: currentVersion,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    });
    expect(approval).toMatchObject({
      status: "approved",
      documentVersion: currentVersion,
    });
    expect(processPdf).toHaveBeenCalledTimes(1);
    expect(processPdf).toHaveBeenCalledWith(meetingId);

    detail = await requiredReview(review, meetingId);
    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    })).resolves.toMatchObject({ status: "invalid_state" });

    expect(detail).toMatchObject({
      status: "AWAITING_SIGNATURE",
      humanOwned: true,
      approval: {
        approvedByProfileId: eleanorId,
        approvedByDisplayName: "Eleanor Hughes",
        contentVersion: currentVersion,
        unresolvedVotesAcknowledged: true,
      },
      pdfArtifact: {
        id: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        documentVersion: currentVersion,
        pageCount: expect.any(Number),
        sizeBytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      pdfAttempt: 1,
    });
    expect(detail.history.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "EDIT_SAVED",
      "DEFERRED",
      "RESUMED",
      "APPROVED",
    ]));
    expect(detail.transcript.content).toBe(workflow.packet.transcript.content);

    const artifact = detail.pdfArtifact;
    if (!artifact) throw new Error("PDF artifact metadata was not returned.");
    await expect(loadMeetingPdfAssociation(meetingId)).resolves.toEqual({
      meetingPdfId: artifact.id,
      artifactMeetingId: meetingId,
      artifactType: "UNSIGNED",
      storagePath: artifact.path,
    });
    await expect(attemptDirectPdfEdit(artifact.id)).resolves.toBe(false);
    const pdfBytes = await downloadPrivatePdf(artifact.path);
    expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(artifact.sha256);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(artifact.pageCount);
    expect(pdf.getTitle()).toBe(`${detail.title} - Meeting Minutes`);
    await expect(downloadPdfWithoutAuthentication(artifact.path)).resolves.not.toBe(200);

    await expect(review.saveMeetingDraft({
      meetingId,
      expectedVersion: detail.version,
      actorProfileId: eleanorId,
      draft: completeDraft(false),
    })).resolves.toMatchObject({ status: "protected" });
    await expect(attemptDirectMotionEdit(meetingId)).resolves.toBe(false);
  }, 30_000);

  it("keeps PDF_FAILED locked and retries from the exact approved snapshot", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const workflow = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      idPrefix: "approval-pdf-retry",
    });
    const meetingId = requiredMeetingId(workflow.meetings[0]?.id);
    const review = reviewService();
    const approvalRepository = createSupabaseMeetingApprovalRepository(configuration);
    const approvalProcess = vi.fn().mockResolvedValue({
      status: "protected" as const,
      meetingId,
      attempt: 0,
    });
    const approvalService = createMeetingApprovalService({
      repository: approvalRepository,
      processPdf: approvalProcess,
    });
    const initial = await requiredReview(review, meetingId);
    const saved = await review.saveMeetingDraft({
      meetingId,
      expectedVersion: initial.version,
      actorProfileId: eleanorId,
      draft: completeDraft(false),
    });
    await expect(approvalService.approveMeeting({
      meetingId,
      expectedVersion: requiredVersion(saved.version),
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    })).resolves.toMatchObject({ status: "approved" });
    expect(approvalProcess).toHaveBeenCalledWith(meetingId);

    const failingProcessor = createMeetingPdfProcessor({
      repository: approvalRepository,
      storage: createSupabaseMinutesPdfStorage(configuration),
      render: vi.fn().mockRejectedValue(new Error("The renderer failed deliberately.")),
    });
    await expect(failingProcessor(meetingId)).resolves.toMatchObject({
      status: "failed",
      attempt: 1,
      error: { code: "pdf_generation_failed" },
    });

    let failed = await requiredReview(review, meetingId);
    expect(failed).toMatchObject({
      status: "PDF_FAILED",
      humanOwned: true,
      pdfArtifact: null,
      pdfAttempt: 1,
      failure: {
        code: "pdf_generation_failed",
        message: "The renderer failed deliberately.",
      },
    });
    const approvedSnapshotBeforeRetry = await loadApprovedSnapshot(meetingId);
    await expect(review.saveMeetingDraft({
      meetingId,
      expectedVersion: failed.version,
      actorProfileId: eleanorId,
      draft: completeDraft(false),
    })).resolves.toMatchObject({ status: "protected" });

    const successfulProcessor = createMeetingPdfProcessor({
      repository: approvalRepository,
      storage: createSupabaseMinutesPdfStorage(configuration),
    });
    const retryService = createMeetingApprovalService({
      repository: approvalRepository,
      processPdf: successfulProcessor,
      processSigning: signingProcessor(new FakeSigningProvider()),
    });
    await expect(retryService.retryMeetingPdf({
      meetingId,
      expectedVersion: failed.version,
      actorProfileId: eleanorId,
    })).resolves.toMatchObject({
      status: "retry_started",
      documentVersion: approvedSnapshotBeforeRetry.meeting.contentVersion,
    });

    failed = await requiredReview(review, meetingId);
    expect(failed).toMatchObject({
      status: "AWAITING_SIGNATURE",
      failure: null,
      pdfAttempt: 2,
      pdfArtifact: {
        id: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        documentVersion: approvedSnapshotBeforeRetry.meeting.contentVersion,
      },
    });
    expect(await loadApprovedSnapshot(meetingId)).toEqual(approvedSnapshotBeforeRetry);
    expect(failed.history.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "APPROVED",
      "PDF_RETRY",
    ]));
  }, 30_000);
});

function reviewService() {
  return createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
}

function signingProcessor(provider: FakeSigningProvider) {
  return createMeetingSigningProcessor({
    repository: createSupabaseMeetingSigningRepository(configuration),
    pdfSource: createSupabaseMinutesPdfStorage(configuration),
    provider,
    recipient: testSigningRecipient,
  });
}

function completeDraft(unresolvedVote: boolean): MeetingReviewDraft {
  return {
    minutes: {
      summary: "The officer reviewed and completed the meeting record.",
      sections: [
        { heading: "Governance", content: "The board considered and approved the revised governance policy." },
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
        { profileId: priyaId, selection: unresolvedVote ? "unresolved" : "abstain" },
      ],
    }],
    tags: ["approved", "governance"],
  };
}

async function requiredReview(service: ReturnType<typeof reviewService>, meetingId: string) {
  const detail = await service.getMeetingReview(meetingId);
  if (!detail) throw new Error(`Meeting ${meetingId} was not found.`);
  return detail;
}

async function downloadPrivatePdf(path: string): Promise<Uint8Array> {
  const response = await fetch(storageObjectUrl(path, true), { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`Private PDF download failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadPdfWithoutAuthentication(path: string): Promise<number> {
  return (await fetch(storageObjectUrl(path, true))).status;
}

function storageObjectUrl(path: string, authenticated: boolean): URL {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `/storage/v1/object/${authenticated ? "authenticated/" : ""}meeting-minutes/${encodedPath}`,
    configuration.apiUrl,
  );
}

async function attemptDirectMotionEdit(meetingId: string): Promise<boolean> {
  const url = new URL("/rest/v1/motions", configuration.apiUrl);
  url.searchParams.set("meeting_id", `eq.${meetingId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ motion_text: "Tampered approved motion." }),
  });
  return response.ok;
}

async function attemptDirectPdfEdit(pdfId: string): Promise<boolean> {
  const url = new URL("/rest/v1/meeting_pdfs", configuration.apiUrl);
  url.searchParams.set("id", `eq.${pdfId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...serviceHeaders(), "content-type": "application/json", prefer: "return=representation" },
    body: JSON.stringify({ storage_path: "unsigned/tampered/minutes.pdf" }),
  });
  return response.ok;
}

async function loadMeetingPdfAssociation(meetingId: string) {
  const meetingUrl = new URL("/rest/v1/meetings", configuration.apiUrl);
  meetingUrl.searchParams.set("id", `eq.${meetingId}`);
  meetingUrl.searchParams.set("select", "unsigned_pdf_id");
  const meetingResponse = await fetch(meetingUrl, { headers: serviceHeaders() });
  if (!meetingResponse.ok) throw new Error(`Meeting PDF association query failed with HTTP ${meetingResponse.status}.`);
  const meetings = await meetingResponse.json() as Array<{ unsigned_pdf_id: string | null }>;
  const meetingPdfId = meetings[0]?.unsigned_pdf_id;
  if (!meetingPdfId) throw new Error("The meeting does not reference an unsigned PDF record.");

  const pdfUrl = new URL("/rest/v1/meeting_pdfs", configuration.apiUrl);
  pdfUrl.searchParams.set("id", `eq.${meetingPdfId}`);
  pdfUrl.searchParams.set("select", "meeting_id,pdf_type,storage_path");
  const pdfResponse = await fetch(pdfUrl, { headers: serviceHeaders() });
  if (!pdfResponse.ok) throw new Error(`Meeting PDF record query failed with HTTP ${pdfResponse.status}.`);
  const pdfs = await pdfResponse.json() as Array<{
    meeting_id: string;
    pdf_type: string;
    storage_path: string;
  }>;
  const pdf = pdfs[0];
  if (!pdf) throw new Error("The associated meeting PDF record was not found.");
  return {
    meetingPdfId,
    artifactMeetingId: pdf.meeting_id,
    artifactType: pdf.pdf_type,
    storagePath: pdf.storage_path,
  };
}

async function loadApprovedSnapshot(meetingId: string) {
  const url = new URL("/rest/v1/meetings", configuration.apiUrl);
  url.searchParams.set("id", `eq.${meetingId}`);
  url.searchParams.set("select", "approved_snapshot");
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`Approved snapshot query failed with HTTP ${response.status}.`);
  const rows = await response.json() as Array<{ approved_snapshot: {
    meeting: { contentVersion: number };
    [key: string]: unknown;
  } }>;
  const snapshot = rows[0]?.approved_snapshot;
  if (!snapshot) throw new Error("Approved snapshot was not stored.");
  return snapshot;
}

function serviceHeaders() {
  return {
    apikey: configuration.secretKey,
    authorization: `Bearer ${configuration.secretKey}`,
  };
}

function requiredMeetingId(value: string | undefined): string {
  if (!value) throw new Error("The workflow did not create a meeting.");
  return value;
}

function requiredVersion(value: number | null): number {
  if (value === null) throw new Error("A successful mutation did not return a meeting version.");
  return value;
}
