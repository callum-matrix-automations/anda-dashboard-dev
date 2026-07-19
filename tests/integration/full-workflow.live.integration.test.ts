import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMinutesPdfStorage } from "../../src/backend/repositories/supabase/supabaseMinutesPdfStorage";
import { analyzeMeetingTranscript } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { createMeetingPdfProcessor } from "../../src/backend/services/pdf/processMeetingPdf";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import type { MeetingDraft } from "../../src/shared/contracts/meetingAnalysis";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
import {
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const liveWorkflowConfigured = configuration.configured
  && Boolean(process.env.OPENAI_API_KEY?.trim());
const approverProfileId = "10000000-0000-4000-8000-000000000001";
const outputPath = resolve("output/pdf/anda-live-gpt41-meeting-minutes.pdf");

describe.skipIf(!liveWorkflowConfigured)("live webhook-to-PDF workflow", () => {
  it("runs the dummy transcript through GPT-4.1, human review, approval, and PDF generation", async () => {
    const workflow = await runPreApprovalWorkflow({
      analyze: analyzeMeetingTranscript,
      idPrefix: "live-gpt41-full-workflow",
    });
    const meetingId = requiredValue(workflow.meetings[0]?.id, "meeting ID");
    const review = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
    const initial = await review.getMeetingReview(meetingId);
    if (!initial) throw new Error(`Live workflow meeting ${meetingId} was not found for review.`);

    const reviewedDraft = prepareApprovableDraft(workflow.draft);
    const saved = await review.saveMeetingDraft({
      meetingId,
      expectedVersion: initial.version,
      actorProfileId: approverProfileId,
      draft: reviewedDraft,
    });
    expect(saved).toMatchObject({ status: "saved" });
    const savedVersion = requiredValue(saved.version, "saved meeting version");

    const approvalRepository = createSupabaseMeetingApprovalRepository(configuration);
    const processPdf = createMeetingPdfProcessor({
      repository: approvalRepository,
      storage: createSupabaseMinutesPdfStorage(configuration),
    });
    const approval = createMeetingApprovalService({
      repository: approvalRepository,
      processPdf,
    });
    await expect(approval.approveMeeting({
      meetingId,
      expectedVersion: savedVersion,
      actorProfileId: approverProfileId,
      acknowledgeUnresolvedVotes: true,
    })).resolves.toMatchObject({ status: "approved" });

    const completed = await review.getMeetingReview(meetingId);
    if (!completed?.pdfArtifact) throw new Error("The live workflow did not produce an associated PDF artifact.");
    expect(completed).toMatchObject({
      status: "AWAITING_SIGNATURE",
      humanOwned: true,
      approval: { approvedByProfileId: approverProfileId },
      pdfArtifact: {
        id: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        documentVersion: savedVersion,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });

    const pdfBytes = await downloadPrivatePdf(completed.pdfArtifact.path);
    expect(createHash("sha256").update(pdfBytes).digest("hex")).toBe(completed.pdfArtifact.sha256);
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(completed.pdfArtifact.pageCount);
    expect(pdf.getTitle()).toBe(`${completed.title} - Meeting Minutes`);
    await expect(loadMeetingPdfId(meetingId)).resolves.toBe(completed.pdfArtifact.id);

    await mkdir(resolve("output/pdf"), { recursive: true });
    await writeFile(outputPath, pdfBytes);

    const omittedIncompleteMotions = workflow.draft.motions.length - reviewedDraft.motions.length;
    process.stdout.write(`\nLive GPT-4.1 full workflow completed:\n${JSON.stringify({
      sourceMeetingId: workflow.packet.meeting.sourceMeetingId,
      meetingId,
      status: completed.status,
      aiMinutesSections: workflow.draft.minutes.sections.length,
      aiMotions: workflow.draft.motions.length,
      approvedFormalMotions: reviewedDraft.motions.length,
      omittedIncompleteMotions,
      pdfId: completed.pdfArtifact.id,
      pdfStoragePath: completed.pdfArtifact.path,
      pdfDocumentVersion: completed.pdfArtifact.documentVersion,
      pdfPageCount: completed.pdfArtifact.pageCount,
      pdfSizeBytes: completed.pdfArtifact.sizeBytes,
      localPdfPath: outputPath,
    }, null, 2)}\n\n`);
  }, 180_000);
});

function prepareApprovableDraft(aiDraft: MeetingDraft): MeetingReviewDraft {
  return {
    minutes: aiDraft.minutes,
    attendeeProfileIds: aiDraft.attendees.map((attendee) => attendee.participantRef),
    motions: aiDraft.motions.flatMap((motion) => {
      if (
        motion.mover.status !== "resolved"
        || motion.seconder.status !== "resolved"
        || motion.outcome === "unresolved"
      ) return [];
      return [{
        text: motion.text,
        moverProfileId: motion.mover.participantRef,
        seconderProfileId: motion.seconder.participantRef,
        outcome: motion.outcome,
        votes: motion.votes.map((vote) => ({
          profileId: vote.participantRef,
          selection: vote.value,
        })),
      }];
    }),
    tags: ["live-gpt41"],
  };
}

async function downloadPrivatePdf(path: string): Promise<Uint8Array> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    new URL(`/storage/v1/object/authenticated/meeting-minutes/${encodedPath}`, configuration.apiUrl),
    { headers: serviceHeaders() },
  );
  if (!response.ok) throw new Error(`Private PDF download failed with HTTP ${response.status}.`);
  return new Uint8Array(await response.arrayBuffer());
}

async function loadMeetingPdfId(meetingId: string): Promise<string | null> {
  const url = new URL("/rest/v1/meetings", configuration.apiUrl);
  url.searchParams.set("id", `eq.${meetingId}`);
  url.searchParams.set("select", "unsigned_pdf_id");
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`Meeting PDF association query failed with HTTP ${response.status}.`);
  const rows = await response.json() as Array<{ unsigned_pdf_id: string | null }>;
  return rows[0]?.unsigned_pdf_id ?? null;
}

function serviceHeaders() {
  return {
    apikey: configuration.secretKey,
    authorization: `Bearer ${configuration.secretKey}`,
  };
}

function requiredValue<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) throw new Error(`The live workflow did not return ${description}.`);
  return value;
}
