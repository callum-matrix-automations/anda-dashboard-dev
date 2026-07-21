import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingArchiveRepository } from "../../src/backend/repositories/supabase/supabaseMeetingArchiveRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { analyzeMeetingTranscript } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingArchiveService } from "../../src/backend/services/archive/meetingArchiveService";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { getMeetingSigningSession } from "../../src/backend/services/signing/getMeetingSigningSession";
import type { MeetingDraft } from "../../src/shared/contracts/meetingAnalysis";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
import { localSupabaseConfiguration, runPreApprovalWorkflow } from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const enabled = process.env.RUN_FIRMA_CALLBACK_LIVE_TEST === "1";
const approverProfileId = "10000000-0000-4000-8000-000000000001";
const waitMilliseconds = Number(process.env.FIRMA_CALLBACK_WAIT_MS ?? 15 * 60 * 1_000);

describe.skipIf(!enabled)("live Firma callback workflow", () => {
  it("waits for a real signature callback and archives the verified signed PDF", async () => {
    if (!configuration.configured) throw new Error("Local Supabase is not configured.");
    const workflow = await runPreApprovalWorkflow({
      analyze: analyzeMeetingTranscript,
      idPrefix: "live-firma-callback",
    });
    const meetingId = required(workflow.meetings[0]?.id, "meeting ID");
    const review = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
    const initial = required(await review.getMeetingReview(meetingId), "meeting review");
    const saved = await review.saveMeetingDraft({
      meetingId,
      expectedVersion: initial.version,
      actorProfileId: approverProfileId,
      draft: prepareApprovableDraft(workflow.draft),
    });
    const savedVersion = required(saved.version, "saved meeting version");
    const approvalRepository = createSupabaseMeetingApprovalRepository(configuration);
    await createMeetingApprovalService({
      repository: approvalRepository,
      processPdf: createMeetingPdfProcessor({
        repository: approvalRepository,
        storage: createSupabaseMinutesPdfStorage(configuration),
      }),
    }).approveMeeting({
      meetingId,
      expectedVersion: savedVersion,
      actorProfileId: approverProfileId,
      acknowledgeUnresolvedVotes: true,
    });

    const signingReview = required(await review.getMeetingReview(meetingId), "approved signing review");
    const unsignedPdf = required(signingReview.pdfArtifact, "unsigned PDF artifact");

    const session = await getMeetingSigningSession(meetingId);
    if (session.status !== "available") {
      throw new Error(`The live signing session is ${session.status}.`);
    }
    process.stdout.write(`\nSign the live Firma document, then leave this test running:\n${session.signingUrl}\n`);
    process.stdout.write(`Waiting up to ${Math.round(waitMilliseconds / 60_000)} minutes for the verified callback and completed archive...\n\n`);

    const finalState = await waitForCompletedArchive(meetingId, session.requestId, waitMilliseconds);
    expect(finalState.request).toMatchObject({
      outcome_status: "READY_FOR_ARCHIVE",
      provider_status: expect.stringMatching(/finished|completed/u),
      signed_document_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      signed_document_size_bytes: expect.any(Number),
    });
    expect(finalState.meeting).toMatchObject({
      status: "COMPLETED",
      signed_by: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      signed_at: expect.any(String),
      signed_pdf_id: expect.stringMatching(/^[a-f0-9-]{36}$/u),
      signed_pdf_path: expect.stringContaining("signed/"),
      unsigned_pdf_id: null,
      completed_at: expect.any(String),
    });
    expect(finalState.events.some((event) => (
      event.processing_status === "PROCESSED"
      && event.event_type.includes("completed")
    ))).toBe(true);

    const archiveStorage = createSupabaseMinutesPdfStorage(configuration);
    const archiveService = createMeetingArchiveService({
      repository: createSupabaseMeetingArchiveRepository(configuration),
      storage: archiveStorage,
      signedUrlSeconds: 60,
    });
    const archiveResult = await archiveService.get(meetingId);
    if (archiveResult.status !== "available") throw new Error("The completed archive record was not available.");
    expect(archiveResult.archive).toMatchObject({
      meetingId,
      category: "Board Meeting",
      signedPdfId: finalState.meeting.signed_pdf_id,
      tags: expect.arrayContaining(["live-firma-callback"]),
      document: {
        pdfId: finalState.meeting.signed_pdf_id,
        sha256: finalState.request.signed_document_sha256,
        sizeBytes: finalState.request.signed_document_size_bytes,
        pageCount: expect.any(Number),
      },
    });
    await expect(archiveStorage.loadApprovedPdf(unsignedPdf.path)).rejects.toMatchObject({
      code: "pdf_storage_download_failed",
    });
    await expect(archiveService.search({
      query: "live-firma-callback",
      year: Number(archiveResult.archive.meetingDate.slice(0, 4)),
      category: "Board Meeting",
      limit: 10,
      offset: 0,
    })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ meetingId })]),
    });

    const accessResult = await archiveService.createDocumentAccess(meetingId);
    if (accessResult.status !== "available") throw new Error("Temporary signed PDF access was not available.");
    const signedPdfResponse = await fetch(accessResult.access.url);
    if (!signedPdfResponse.ok) {
      throw new Error(`Temporary signed PDF download failed with HTTP ${signedPdfResponse.status}.`);
    }
    const signedPdfBytes = new Uint8Array(await signedPdfResponse.arrayBuffer());
    expect(signedPdfBytes.byteLength).toBe(finalState.request.signed_document_size_bytes);
    expect(createHash("sha256").update(signedPdfBytes).digest("hex"))
      .toBe(finalState.request.signed_document_sha256);

    process.stdout.write(`Verified Firma callback and completed archive:\n${JSON.stringify({
      meetingId,
      requestId: session.requestId,
      externalRequestId: session.externalRequestId,
      outcomeStatus: finalState.request.outcome_status,
      meetingStatus: finalState.meeting.status,
      signedPdfId: finalState.meeting.signed_pdf_id,
      signedPdfPath: finalState.meeting.signed_pdf_path,
      signedDocumentSha256: finalState.request.signed_document_sha256,
      signedDocumentSizeBytes: finalState.request.signed_document_size_bytes,
      signedDocumentPageCount: archiveResult.archive.document.pageCount,
      unsignedPdfRemoved: true,
      archiveSearchVerified: true,
      temporarySignedDownloadVerified: true,
      processedWebhookEvents: finalState.events.length,
    }, null, 2)}\n`);
  }, waitMilliseconds + 180_000);
});

function prepareApprovableDraft(aiDraft: MeetingDraft): MeetingReviewDraft {
  return {
    minutes: aiDraft.minutes,
    attendeeProfileIds: aiDraft.attendees.map((attendee) => attendee.participantRef),
    motions: aiDraft.motions.flatMap((motion) => {
      if (
        motion.mover.status !== "resolved"
        || motion.outcome === "unresolved"
        || (motion.outcome !== "not_seconded" && motion.seconder.status !== "resolved")
      ) return [];
      return [{
        text: motion.text,
        moverProfileId: motion.mover.participantRef,
        seconderProfileId: motion.seconder.status === "resolved" ? motion.seconder.participantRef : null,
        outcome: motion.outcome,
        votes: motion.votes.map((vote) => ({
          profileId: vote.participantRef,
          selection: vote.value,
        })),
      }];
    }),
    tags: ["live-firma-callback"],
  };
}

async function waitForCompletedArchive(meetingId: string, requestId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const request = await requiredRow<SigningRequestState>(
      "meeting_signing_requests",
      "id",
      requestId,
      "outcome_status,provider_status,signed_document_sha256,signed_document_size_bytes,last_error_code,last_error_message",
    );
    const meeting = await requiredRow<MeetingState>(
      "meetings",
      "id",
      meetingId,
      "status,signed_by,signed_at,signed_pdf_id,signed_pdf_path,unsigned_pdf_id,completed_at,last_error_code,last_error_message",
    );
    if (request.outcome_status === "READY_FOR_ARCHIVE" && meeting.status === "COMPLETED") {
      const events = await selectRows<WebhookEventState>(
        "signing_webhook_events",
        "signing_request_id",
        requestId,
        "event_type,processing_status",
      );
      return { request, meeting, events };
    }
    if (meeting.status === "ARCHIVE_FAILED") {
      throw new Error(`Archive processing failed: ${meeting.last_error_code} - ${meeting.last_error_message}`);
    }
    if (request.outcome_status.endsWith("FAILED")) {
      throw new Error(`Firma callback processing failed: ${request.last_error_code} - ${request.last_error_message}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000));
  }
  throw new Error("Timed out waiting for the Firma signing callback.");
}

interface SigningRequestState {
  outcome_status: string;
  provider_status: string | null;
  signed_document_sha256: string | null;
  signed_document_size_bytes: number | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

interface MeetingState {
  status: string;
  signed_by: string | null;
  signed_at: string | null;
  signed_pdf_id: string | null;
  signed_pdf_path: string | null;
  unsigned_pdf_id: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

interface WebhookEventState {
  event_type: string;
  processing_status: string;
}

async function requiredRow<T>(table: string, column: string, value: string, select: string) {
  const rows = await selectRows<T>(table, column, value, select);
  const row = rows[0];
  if (!row) throw new Error(`${table} did not contain ${column}=${value}.`);
  return row;
}

async function selectRows<T>(table: string, column: string, value: string, select: string): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, configuration.apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, { headers: {
    apikey: configuration.secretKey,
    authorization: `Bearer ${configuration.secretKey}`,
  } });
  if (!response.ok) throw new Error(`${table} query failed with HTTP ${response.status}.`);
  return response.json() as Promise<T[]>;
}

function required<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${description}.`);
  return value;
}
