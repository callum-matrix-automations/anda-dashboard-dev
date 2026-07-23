import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
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
const danielId = "10000000-0000-4000-8000-000000000004";

describe.skipIf(!localIntegrationConfigured)("local Supabase meeting review", () => {
  it("loads, atomically edits, version-checks, and protects a PENDING_APPROVAL meeting", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const workflow = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      idPrefix: "meeting-review-edit",
    });
    const meetingId = requiredMeetingId(workflow.meetings[0]?.id);
    const service = reviewService();
    const before = await service.getMeetingReview(meetingId);

    expect(before).not.toBeNull();
    if (!before) throw new Error("Expected a reviewable meeting.");
    const originalTranscript = before.transcript;
    await expect(service.listMeetingReviews()).resolves.toContainEqual(expect.objectContaining({
      id: meetingId,
      status: "PENDING_APPROVAL",
    }));

    const draft = editedDraft();
    const saved = await service.saveMeetingDraft({
      meetingId,
      expectedVersion: before.version,
      actorProfileId: eleanorId,
      draft,
    });
    expect(saved).toEqual({ status: "saved", meetingId, version: before.version + 1 });

    await expect(service.saveMeetingDraft({
      meetingId,
      expectedVersion: before.version,
      actorProfileId: eleanorId,
      draft: { ...draft, tags: ["stale-write"] },
    })).resolves.toEqual({ status: "conflict", meetingId, version: saved.version });

    const after = await service.getMeetingReview(meetingId);
    expect(after).toMatchObject({
      status: "PENDING_APPROVAL",
      version: saved.version,
      humanOwned: true,
      tags: ["reviewed", "governance"],
      minutes: draft.minutes,
      transcript: originalTranscript,
    });
    expect(after?.attendees.map((attendee) => attendee.profileId)).toEqual(expect.arrayContaining(
      draft.attendeeProfileIds,
    ));
    expect(after?.motions).toEqual([
      expect.objectContaining({
        text: "Adopt the revised governance policy.",
        outcome: "tabled",
        moverProfileId: eleanorId,
        seconderProfileId: marcusId,
        votes: expect.arrayContaining([
          expect.objectContaining({ profileId: eleanorId, selection: "for" }),
          expect.objectContaining({ profileId: priyaId, selection: "unresolved" }),
        ]),
      }),
    ]);
    expect(after?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ actorProfileId: eleanorId, action: "EDIT_SAVED" }),
    ]));

    const analysisRepository = createSupabaseMeetingAnalysisRepository(configuration);
    await expect(analysisRepository.claimAnalysis(meetingId)).resolves.toMatchObject({ status: "protected" });
  }, 30_000);

  it("enforces editor permissions and supports deferring and resuming review", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const workflow = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      idPrefix: "meeting-review-defer",
    });
    const meetingId = requiredMeetingId(workflow.meetings[0]?.id);
    const service = reviewService();
    const before = await requiredReview(service, meetingId);

    await expect(service.deferMeetingReview({
      meetingId,
      expectedVersion: before.version,
      actorProfileId: danielId,
      note: "A normal member cannot defer this meeting.",
    })).resolves.toEqual({ status: "forbidden", meetingId, version: before.version });

    const deferred = await service.deferMeetingReview({
      meetingId,
      expectedVersion: before.version,
      actorProfileId: eleanorId,
      note: "Awaiting supporting evidence.",
    });
    expect(deferred).toEqual({ status: "deferred", meetingId, version: before.version + 1 });
    const deferredDetail = await requiredReview(service, meetingId);
    expect(deferredDetail).toMatchObject({
      status: "PENDING_APPROVAL",
      version: deferred.version,
      humanOwned: true,
      deferredAt: expect.any(String),
      deferredNote: "Awaiting supporting evidence.",
    });

    await expect(service.saveMeetingDraft({
      meetingId,
      expectedVersion: deferredDetail.version,
      actorProfileId: eleanorId,
      draft: editedDraft(),
    })).resolves.toEqual({ status: "protected", meetingId, version: deferredDetail.version });

    const resumed = await service.resumeMeetingReview({
      meetingId,
      expectedVersion: deferredDetail.version,
      actorProfileId: eleanorId,
    });
    expect(resumed).toEqual({ status: "resumed", meetingId, version: deferredDetail.version + 1 });
    const resumedDetail = await requiredReview(service, meetingId);
    expect(resumedDetail).toMatchObject({
      status: "PENDING_APPROVAL",
      deferredAt: null,
      deferredNote: null,
      version: resumed.version,
    });
    expect(resumedDetail.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "DEFERRED", note: "Awaiting supporting evidence." }),
      expect.objectContaining({ action: "RESUMED", note: null }),
    ]));
  }, 30_000);

  it("allows an officer to replace failed AI output and return it to PENDING_APPROVAL", async () => {
    const meeting = await createAiFailedMeeting();
    const service = reviewService();
    const failed = await requiredReview(service, meeting.meetingId);

    expect(failed).toMatchObject({
      status: "AI_FAILED",
      minutes: null,
      failure: {
        code: "invalid_analysis_output",
        message: "The final AI response did not match the schema.",
        at: expect.any(String),
      },
    });
    await expect(service.markMeetingReady({
      meetingId: meeting.meetingId,
      expectedVersion: failed.version,
      actorProfileId: eleanorId,
    })).resolves.toEqual({ status: "invalid_state", meetingId: meeting.meetingId, version: failed.version });

    const saved = await service.saveMeetingDraft({
      meetingId: meeting.meetingId,
      expectedVersion: failed.version,
      actorProfileId: eleanorId,
      draft: editedDraft(),
    });
    expect(saved).toEqual({ status: "saved", meetingId: meeting.meetingId, version: failed.version + 1 });
    expect((await requiredReview(service, meeting.meetingId)).status).toBe("AI_FAILED");

    const ready = await service.markMeetingReady({
      meetingId: meeting.meetingId,
      expectedVersion: requiredVersion(saved.version),
      actorProfileId: eleanorId,
    });
    expect(ready).toEqual({ status: "ready", meetingId: meeting.meetingId, version: requiredVersion(saved.version) + 1 });

    const reviewable = await requiredReview(service, meeting.meetingId);
    expect(reviewable).toMatchObject({
      status: "PENDING_APPROVAL",
      humanOwned: true,
      failure: {
        code: "invalid_analysis_output",
        message: "The final AI response did not match the schema.",
      },
      transcript: {
        content: meeting.transcriptContent,
      },
    });
    expect(reviewable.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "EDIT_SAVED" }),
      expect.objectContaining({ action: "MARKED_READY" }),
    ]));

    const analysisRepository = createSupabaseMeetingAnalysisRepository(configuration);
    await expect(analysisRepository.claimAnalysis(meeting.meetingId)).resolves.toMatchObject({ status: "protected" });
  }, 30_000);
});

function reviewService() {
  return createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
}

function editedDraft(): MeetingReviewDraft {
  return {
    minutes: {
      summary: "The officer reviewed and corrected the draft meeting record.",
      sections: [
        { heading: "Review", content: "Names, decisions, and vote records were checked against the transcript." },
        { heading: "Next steps", content: "The revised record is ready to continue through the workflow." },
      ],
    },
    attendeeProfileIds: [eleanorId, marcusId, priyaId],
    motions: [{
      text: "Adopt the revised governance policy.",
      moverProfileId: eleanorId,
      seconderProfileId: marcusId,
      outcome: "tabled",
      votes: [
        { profileId: eleanorId, selection: "for" },
        { profileId: marcusId, selection: "abstain" },
        { profileId: priyaId, selection: "unresolved" },
      ],
    }],
    tags: ["reviewed", "governance"],
  };
}

async function createAiFailedMeeting() {
  const suffix = randomUUID();
  const transcriptContent = "Eleanor Hughes: The meeting record requires manual recovery after analysis failed.";
  const storeTranscript = createTranscriptImportStore(createSupabaseTranscriptRepository(configuration));
  const stored = await storeTranscript({
    eventId: `review-failure-event-${suffix}`,
    eventType: "transcript.ready",
    occurredAt: "2026-07-19T10:00:00.000Z",
    sentAt: "2026-07-19T10:01:00.000Z",
    meeting: {
      sourceMeetingId: `review-failure-meeting-${suffix}`,
      title: "Meeting review failure recovery",
      startedAt: "2026-07-19T09:00:00.000Z",
      endedAt: "2026-07-19T10:00:00.000Z",
      durationMinutes: 60,
    },
    attendees: [
      { displayName: "Eleanor Hughes" },
      { displayName: "Marcus Patel" },
      { displayName: "Priya Shah" },
    ],
    transcript: {
      sourceTranscriptId: `review-failure-transcript-${suffix}`,
      contentType: "text/plain",
      language: "en-GB",
      content: transcriptContent,
    },
  });
  const analysisRepository = createSupabaseMeetingAnalysisRepository(configuration);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = await analysisRepository.claimAnalysis(stored.meetingId);
    if (claim.status !== "claimed") throw new Error(`Expected analysis claim ${attempt}, received ${claim.status}.`);
    const result = await analysisRepository.recordFailure(stored.meetingId, claim.runId, {
      code: attempt === 3 ? "invalid_analysis_output" : "provider_failure",
      message: attempt === 3
        ? "The final AI response did not match the schema."
        : `AI provider failure on attempt ${attempt}.`,
    });
    expect(result).toBe(attempt === 3 ? "failed" : "retry_scheduled");
  }
  return { meetingId: stored.meetingId, transcriptContent };
}

async function requiredReview(service: ReturnType<typeof reviewService>, meetingId: string) {
  const review = await service.getMeetingReview(meetingId);
  if (!review) throw new Error(`Meeting ${meetingId} was not returned for review.`);
  return review;
}

function requiredMeetingId(value: string | undefined): string {
  if (!value) throw new Error("The workflow did not create a meeting.");
  return value;
}

function requiredVersion(value: number | null): number {
  if (value === null) throw new Error("A successful mutation did not return a version.");
  return value;
}
