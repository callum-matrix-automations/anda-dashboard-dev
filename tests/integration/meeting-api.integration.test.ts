import { describe, expect, it, vi } from "vitest";
import {
  createDeferMeetingHandler,
  createMeetingDetailHandler,
  createMeetingListHandler,
  createResumeMeetingHandler,
  createRetryMeetingAnalysisHandler,
  createSaveMeetingDraftHandler,
} from "../../src/backend/integrations/meetings/meetingApiHandlers";
import { adaptReadAiWebhook } from "../../src/backend/integrations/read-ai/readAiTranscriptAdapter";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import {
  createSupabaseMeetingAnalysisRetryRepository,
} from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRetryRepository";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createMeetingAnalysisProcessor } from "../../src/backend/services/ai/processMeetingAnalysis";
import { createMeetingAnalysisRetryService } from "../../src/backend/services/ai/retryMeetingAnalysis";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import type { MeetingReviewDraft } from "../../src/shared/contracts/meetingReview";
import {
  createUniqueReadAiPayload,
  loadPredefinedMeetingDraft,
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const officerId = "10000000-0000-4000-8000-000000000001";
const marcusId = "10000000-0000-4000-8000-000000000002";
const priyaId = "10000000-0000-4000-8000-000000000003";
const officerResolver = vi.fn().mockResolvedValue({
  profileId: officerId,
  displayName: "Eleanor Hughes",
  role: "OFFICER" as const,
  isAdmin: false,
});

describe.skipIf(!configuration.configured)("local Supabase meeting controller workflow", () => {
  it("lists, loads, edits, version-checks, defers, and resumes through HTTP handlers", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const workflow = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      idPrefix: "meeting-api-controller",
    });
    const meetingId = required(workflow.meetings[0]?.id);
    const review = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
    const services = controllerServices(review);
    const options = { services, actorResolver: officerResolver };

    const list = await createMeetingListHandler(options)(request(
      "/api/meetings?queue=needs-review&status=PENDING_APPROVAL&limit=100",
    ));
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: meetingId })]),
    });

    const detailHandler = createMeetingDetailHandler(options);
    const detail = await detailHandler(request(`/api/meetings/${meetingId}`), context(meetingId));
    expect(detail.status).toBe(200);
    const before = await detail.json() as {
      version: number;
      category: string;
      transcript: { content: string };
      source: { startedAt: string | null; endedAt: string | null };
      sourceParticipants: Array<{ email: string | null; matchStatus: string; profileId: string | null }>;
    };
    expect(before.transcript.content).toBe(workflow.packet.transcript.content);
    expect(before.category).toBe("Board Meeting");
    expect(before.source).toMatchObject({
      startedAt: workflow.packet.meeting.startedAt,
      endedAt: workflow.packet.meeting.endedAt,
    });
    expect(before.sourceParticipants).toHaveLength(5);
    expect(before.sourceParticipants.every((participant) => (
      participant.email && participant.profileId && participant.matchStatus === "matched"
    ))).toBe(true);

    const save = createSaveMeetingDraftHandler(options);
    const saved = await save(jsonRequest(`/api/meetings/${meetingId}/draft`, "PATCH", {
      expectedVersion: before.version,
      draft: editedDraft(),
    }), context(meetingId));
    expect(saved.status).toBe(200);
    const savedBody = await saved.json() as { version: number };
    expect(savedBody.version).toBe(before.version + 1);

    const stale = await save(jsonRequest(`/api/meetings/${meetingId}/draft`, "PATCH", {
      expectedVersion: before.version,
      draft: editedDraft(),
    }), context(meetingId));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "version_conflict", currentVersion: savedBody.version },
    });

    const deferred = await createDeferMeetingHandler(options)(jsonRequest(
      `/api/meetings/${meetingId}/defer`,
      "POST",
      { expectedVersion: savedBody.version, note: "Awaiting supporting evidence." },
    ), context(meetingId));
    expect(deferred.status).toBe(200);
    const deferredBody = await deferred.json() as { version: number };

    const deferredList = await createMeetingListHandler(options)(request(
      "/api/meetings?queue=deferred&limit=100",
    ));
    await expect(deferredList.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({
        id: meetingId,
        deferredNote: "Awaiting supporting evidence.",
      })]),
    });

    const resumed = await createResumeMeetingHandler(options)(jsonRequest(
      `/api/meetings/${meetingId}/resume`,
      "POST",
      { expectedVersion: deferredBody.version },
    ), context(meetingId));
    expect(resumed.status).toBe(200);

    const after = await detailHandler(request(`/api/meetings/${meetingId}`), context(meetingId));
    await expect(after.json()).resolves.toMatchObject({
      id: meetingId,
      deferredAt: null,
      deferredNote: null,
      humanOwned: true,
      minutes: editedDraft().minutes,
      tags: editedDraft().tags,
      history: expect.arrayContaining([
        expect.objectContaining({ action: "EDIT_SAVED" }),
        expect.objectContaining({ action: "DEFERRED" }),
        expect.objectContaining({ action: "RESUMED" }),
      ]),
    });
  }, 30_000);

  it("retries an AI_FAILED meeting through the versioned controller and records recovery", async () => {
    const predefinedDraft = await loadPredefinedMeetingDraft();
    const payload = await createUniqueReadAiPayload("meeting-api-analysis-retry");
    const adapted = adaptReadAiWebhook(payload, {
      receivedAt: () => new Date("2026-07-25T19:00:01.000Z"),
    });
    if (adapted.status !== "ready") throw new Error("The meeting_end fixture was unexpectedly ignored.");

    const transcriptRepository = createSupabaseTranscriptRepository(configuration);
    const stored = await createTranscriptImportStore(transcriptRepository)(adapted.packet);
    const analysisRepository = createSupabaseMeetingAnalysisRepository(configuration);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claim = await analysisRepository.claimAnalysis(stored.meetingId);
      if (claim.status !== "claimed") throw new Error(`Expected analysis claim ${attempt}, received ${claim.status}.`);
      const failure = await analysisRepository.recordFailure(stored.meetingId, claim.runId, {
        code: "test_analysis_failure",
        message: "The test intentionally exhausted the initial analysis attempts.",
      });
      expect(failure).toBe(attempt === 3 ? "failed" : "retry_scheduled");
    }

    const review = createMeetingReviewService(createSupabaseMeetingReviewRepository(configuration));
    const failed = await review.getMeetingReview(stored.meetingId);
    if (!failed) throw new Error("The AI_FAILED meeting could not be loaded.");
    expect(failed.status).toBe("AI_FAILED");
    expect(failed.humanOwned).toBe(false);

    const processAnalysis = createMeetingAnalysisProcessor({
      repository: analysisRepository,
      analyze: vi.fn().mockResolvedValue(predefinedDraft),
      delay: async () => undefined,
    });
    const retryMeetingAnalysis = createMeetingAnalysisRetryService({
      repository: createSupabaseMeetingAnalysisRetryRepository(configuration),
      processAnalysis,
    });
    const services = {
      ...controllerServices(review),
      retryMeetingAnalysis,
    };
    const response = await createRetryMeetingAnalysisHandler({
      services,
      actorResolver: officerResolver,
    })(jsonRequest(`/api/meetings/${stored.meetingId}/analysis/retry`, "POST", {
      expectedVersion: failed.version,
    }), context(stored.meetingId));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "analysis_retry_completed",
      meetingId: stored.meetingId,
      attempt: 1,
    });

    const recovered = await review.getMeetingReview(stored.meetingId);
    expect(recovered).toMatchObject({
      status: "PENDING_APPROVAL",
      failure: null,
      minutes: predefinedDraft.minutes,
      history: expect.arrayContaining([
        expect.objectContaining({ action: "AI_RETRY", actorProfileId: officerId }),
      ]),
    });
  }, 30_000);
});

function controllerServices(review: ReturnType<typeof createMeetingReviewService>) {
  return {
    ...review,
    retryMeetingAnalysis: vi.fn(),
    approveMeeting: vi.fn(),
    retryMeetingPdf: vi.fn(),
    getMeetingSigningSession: vi.fn(),
    retryMeetingSigning: vi.fn(),
    rejectMeetingSigning: vi.fn(),
    retryMeetingSigningOutcome: vi.fn(),
    searchArchive: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
  };
}

function editedDraft(): MeetingReviewDraft {
  return {
    minutes: {
      summary: "The officer reviewed and corrected the meeting record.",
      sections: [{
        heading: "Review",
        content: "The minutes, attendees, motions, and votes were checked against the transcript.",
      }],
    },
    attendeeProfileIds: [officerId, marcusId, priyaId],
    motions: [],
    tags: ["controller-tested"],
  };
}

function request(path: string) {
  return new Request(`https://anda.test${path}`);
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`https://anda.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(meetingId: string) {
  return { params: Promise.resolve({ meetingId }) };
}

function required(value: string | undefined) {
  if (!value) throw new Error("The workflow did not create a meeting.");
  return value;
}
