import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import type { MeetingDraft } from "../../src/shared/contracts/meetingAnalysis";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const localIntegrationConfigured = isLoopbackUrl(apiUrl) && Boolean(secretKey) && !secretKey.startsWith("replace-");

const eleanorId = "10000000-0000-4000-8000-000000000001";
const marcusId = "10000000-0000-4000-8000-000000000002";

describe.skipIf(!localIntegrationConfigured)("local Supabase meeting analysis persistence", () => {
  it("atomically stores minutes, motions, and votes without changing source evidence", async () => {
    const sourceContent = "Eleanor Hughes: I move. Marcus Patel: I second. The decision is recorded.";
    const stored = await createStoredMeeting(sourceContent);
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
    const claimed = await repository.claimAnalysis(stored.meetingId);
    if (claimed.status !== "claimed") throw new Error(`Expected claimed analysis, received ${claimed.status}.`);

    const draft = analysisDraft();
    expect(await repository.persistDraft(stored.meetingId, claimed.runId, draft)).toBe("saved");
    expect(await repository.persistDraft(stored.meetingId, claimed.runId, draft)).toBe("stale");
    await expect(repository.claimAnalysis(stored.meetingId)).resolves.toMatchObject({
      status: "already_completed",
    });

    const meetings = await selectRows("meetings", "id", stored.meetingId,
      "status,minutes,analysis_attempt,analysis_run_id,human_owned,last_error_code");
    const attendees = await selectRows("meeting_attendees", "meeting_id", stored.meetingId,
      "id,profile_id,display_name_snapshot");
    const motions = await selectRows("motions", "meeting_id", stored.meetingId,
      "id,motion_text,moved_by_attendee_id,seconded_by_attendee_id,outcome");
    const votes = await selectRows("votes", "meeting_id", stored.meetingId,
      "motion_id,attendee_id,selection");
    const transcripts = await selectRows("transcripts", "id", stored.transcriptId,
      "content,source_transcript_id");

    expect(meetings).toEqual([{
      status: "PENDING_APPROVAL",
      minutes: draft.minutes,
      analysis_attempt: 1,
      analysis_run_id: null,
      human_owned: false,
      last_error_code: null,
    }]);
    expect(attendees).toHaveLength(2);
    expect(motions).toHaveLength(3);
    expect(motions).toEqual(expect.arrayContaining([
      expect.objectContaining({ motion_text: "Approve the prior minutes.", outcome: "CARRIED" }),
      expect.objectContaining({ motion_text: "Table the policy decision.", outcome: "TABLED" }),
      expect.objectContaining({ motion_text: "Consider further training.", outcome: null, seconded_by_attendee_id: null }),
    ]));
    expect(votes).toHaveLength(3);
    expect(votes).toEqual(expect.arrayContaining([
      expect.objectContaining({ selection: "FOR" }),
      expect.objectContaining({ selection: "AGAINST" }),
      expect.objectContaining({ selection: null }),
    ]));
    expect(transcripts).toEqual([{
      content: sourceContent,
      source_transcript_id: stored.sourceTranscriptId,
    }]);
  });

  it("rejects late results, reaches AI_FAILED on attempt three, and permits manual recovery", async () => {
    const stored = await createStoredMeeting("Chair: This meeting will exercise failure recovery.");
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });

    const first = await repository.claimAnalysis(stored.meetingId);
    if (first.status !== "claimed") throw new Error("First analysis attempt was not claimed.");
    expect(await repository.recordFailure(stored.meetingId, first.runId, {
      code: "provider_failure",
      message: "Provider failed on attempt one.",
    })).toBe("retry_scheduled");

    const second = await repository.claimAnalysis(stored.meetingId);
    if (second.status !== "claimed") throw new Error("Second analysis attempt was not claimed.");
    expect(await repository.persistDraft(stored.meetingId, first.runId, analysisDraft())).toBe("stale");
    expect(await repository.recordFailure(stored.meetingId, second.runId, {
      code: "openai_timeout",
      message: "Provider timed out on attempt two.",
    })).toBe("retry_scheduled");

    const third = await repository.claimAnalysis(stored.meetingId);
    if (third.status !== "claimed") throw new Error("Third analysis attempt was not claimed.");
    expect(await repository.recordFailure(stored.meetingId, third.runId, {
      code: "invalid_analysis_output",
      message: "Provider output was malformed on attempt three.",
    })).toBe("failed");

    expect(await selectRows("meetings", "id", stored.meetingId,
      "status,analysis_attempt,analysis_run_id,last_error_code,last_error_message,last_error_at")).toEqual([
      expect.objectContaining({
        status: "AI_FAILED",
        analysis_attempt: 3,
        analysis_run_id: null,
        last_error_code: "invalid_analysis_output",
        last_error_message: "Provider output was malformed on attempt three.",
        last_error_at: expect.any(String),
      }),
    ]);
    await expect(repository.claimAnalysis(stored.meetingId)).resolves.toMatchObject({
      status: "retry_required",
      attempt: 3,
    });

    const recovery = await repository.claimAnalysis(stored.meetingId, { manualRetry: true });
    expect(recovery).toMatchObject({ status: "claimed", attempt: 1 });
    expect(await selectRows("meetings", "id", stored.meetingId,
      "status,analysis_attempt,last_error_code")).toEqual([{
      status: "AI_PROCESSING",
      analysis_attempt: 1,
      last_error_code: null,
    }]);
  });

  it("refuses analysis when meeting content has become human owned", async () => {
    const stored = await createStoredMeeting("Chair: Human ownership guard test.");
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
    await expect(repository.markHumanOwned(stored.meetingId)).resolves.toBe("marked");

    await expect(repository.claimAnalysis(stored.meetingId)).resolves.toMatchObject({
      status: "protected",
    });
    await expect(repository.markHumanOwned(stored.meetingId)).resolves.toBe("marked");
  });
});

function analysisDraft(): MeetingDraft {
  return {
    schemaVersion: "1.0",
    minutes: {
      summary: "The board considered three proposals.",
      sections: [{ heading: "Decisions", content: "One motion carried, one was tabled, and one remained unresolved." }],
    },
    attendees: [
      { participantRef: eleanorId, displayName: "Eleanor Hughes" },
      { participantRef: marcusId, displayName: "Marcus Patel" },
    ],
    motions: [
      {
        text: "Approve the prior minutes.",
        mover: { status: "resolved", participantRef: eleanorId },
        seconder: { status: "resolved", participantRef: marcusId },
        outcome: "carried",
        votes: [
          { participantRef: eleanorId, value: "for" },
          { participantRef: marcusId, value: "against" },
        ],
      },
      {
        text: "Table the policy decision.",
        mover: { status: "resolved", participantRef: marcusId },
        seconder: { status: "resolved", participantRef: eleanorId },
        outcome: "tabled",
        votes: [],
      },
      {
        text: "Consider further training.",
        mover: { status: "resolved", participantRef: eleanorId },
        seconder: { status: "unresolved", participantRef: null },
        outcome: "unresolved",
        votes: [{ participantRef: marcusId, value: "unresolved" }],
      },
    ],
  };
}

async function createStoredMeeting(content: string) {
  const suffix = randomUUID();
  const sourceMeetingId = `analysis_meeting_${suffix}`;
  const sourceTranscriptId = `analysis_transcript_${suffix}`;
  const transcriptRepository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
  const storeTranscript = createTranscriptImportStore(transcriptRepository);
  const stored = await storeTranscript({
    eventId: `analysis_event_${suffix}`,
    eventType: "transcript.ready",
    occurredAt: "2026-07-19T10:00:00.000Z",
    sentAt: "2026-07-19T10:01:00.000Z",
    meeting: {
      sourceMeetingId,
      title: "Analysis persistence integration meeting",
      startedAt: "2026-07-19T09:00:00.000Z",
      endedAt: "2026-07-19T10:00:00.000Z",
      durationMinutes: 60,
    },
    attendees: [{ displayName: "Eleanor Hughes" }, { displayName: "Marcus Patel" }],
    transcript: {
      sourceTranscriptId,
      contentType: "text/plain",
      language: "en-GB",
      content,
    },
  });
  return { ...stored, sourceMeetingId, sourceTranscriptId };
}

async function selectRows(table: string, column: string, value: string, select: string): Promise<unknown[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, { headers: serviceHeaders() });
  if (!response.ok) throw new Error(`Local Supabase query failed with HTTP ${response.status}.`);
  return response.json() as Promise<unknown[]>;
}

function serviceHeaders() {
  return {
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
  };
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
