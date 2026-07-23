import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ServerActor } from "../../src/backend/auth/serverActor";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createMeetingAnalysisProcessor } from "../../src/backend/services/ai/processMeetingAnalysis";
import { createManualTranscriptUploadProcessor } from "../../src/backend/services/transcripts/processManualTranscriptUpload";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import type {
  MeetingAnalysisInput,
  MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const localIntegrationConfigured = isLoopbackUrl(apiUrl)
  && Boolean(secretKey)
  && !secretKey.startsWith("replace-");

const actor: ServerActor = {
  profileId: "10000000-0000-4000-8000-000000000001",
  displayName: "Eleanor Hughes",
  role: "OFFICER",
  isAdmin: true,
};

describe.skipIf(!localIntegrationConfigured)("manual transcript upload workflow", () => {
  it("links exact-name speakers and persists motions from the live-analysis transcript", async () => {
    const transcript = await readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8");
    const transcriptRepository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
    const analysisRepository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
    let analysisInput: MeetingAnalysisInput | null = null;
    const processAnalysis = createMeetingAnalysisProcessor({
      repository: analysisRepository,
      analyze: async (input) => {
        analysisInput = input;
        return deterministicDraft(input);
      },
      retryDelaysMs: [],
    });
    const processUpload = createManualTranscriptUploadProcessor({
      store: createTranscriptImportStore(transcriptRepository),
      analyze: processAnalysis,
      createId: randomUUID,
      now: () => new Date("2026-07-24T09:00:00.000Z"),
    });

    const result = await processUpload({
      title: "Manual ANDA board meeting workflow test",
      meetingDate: "2026-07-25",
      durationMinutes: 90,
      transcript,
    }, actor);

    expect(result).toMatchObject({ status: "pending_approval", analysisAttempt: 1 });
    expect(analysisInput).not.toBeNull();
    expect(analysisInput!.transcript.content).toBe(transcript.trim());
    expect(analysisInput!.participants).toHaveLength(5);
    expect(analysisInput!.participants.map((participant) => participant.displayName)).toEqual(expect.arrayContaining([
      "Eleanor Hughes",
      "Marcus Patel",
      "Priya Shah",
      "Daniel Brooks",
      "Amelia Clarke",
    ]));

    const [meeting] = await selectRows("meetings", "id", result.meetingId, "status,minutes");
    const attendees = await selectRows(
      "meeting_attendees",
      "meeting_id",
      result.meetingId,
      "profile_id,display_name_snapshot,source_email_snapshot",
    );
    const motions = await selectRows(
      "motions",
      "meeting_id",
      result.meetingId,
      "motion_text,outcome",
    );

    expect(meeting).toMatchObject({
      status: "PENDING_APPROVAL",
      minutes: expect.objectContaining({
        summary: expect.stringContaining("five formal motions"),
      }),
    });
    expect(attendees).toHaveLength(5);
    expect(attendees).toEqual(expect.arrayContaining([
      expect.objectContaining({
        display_name_snapshot: "Eleanor Hughes",
        source_email_snapshot: null,
      }),
      expect.objectContaining({
        display_name_snapshot: "Marcus Patel",
        source_email_snapshot: null,
      }),
    ]));
    expect(motions).toHaveLength(5);
    expect(motions.map((motion) => motion.outcome)).toEqual(expect.arrayContaining([
      "CARRIED",
      "FAILED",
      "TABLED",
      "NOT_SECONDED",
    ]));
  });
});

function deterministicDraft(input: MeetingAnalysisInput): MeetingDraft {
  const participant = (displayName: string) => {
    const match = input.participants.find((candidate) => candidate.displayName === displayName);
    if (!match) throw new Error(`Missing expected manual transcript participant: ${displayName}`);
    return match.participantRef;
  };
  const eleanor = participant("Eleanor Hughes");
  const marcus = participant("Marcus Patel");
  const priya = participant("Priya Shah");
  const daniel = participant("Daniel Brooks");
  const amelia = participant("Amelia Clarke");

  return {
    schemaVersion: "1.0",
    minutes: {
      summary: "The board considered five formal motions and recorded their outcomes.",
      sections: [{
        heading: "Decisions",
        content: "Two motions carried, one failed, one was tabled, and one was not seconded.",
      }],
    },
    attendees: input.participants,
    motions: [
      motion("Approve the June minutes as corrected.", daniel, amelia, "carried", [
        { participantRef: eleanor, value: "for" },
        { participantRef: marcus, value: "for" },
        { participantRef: priya, value: "for" },
        { participantRef: daniel, value: "for" },
        { participantRef: amelia, value: "for" },
      ]),
      motion("Appoint Northside Surveying for the roof condition survey.", amelia, marcus, "carried"),
      motion("Approve and fund the courtyard community garden.", daniel, marcus, "failed"),
      motion("Adopt procurement policy version four.", marcus, amelia, "tabled"),
      {
        text: "Allocate up to £2,000 for governance training.",
        mover: { status: "resolved", participantRef: daniel },
        seconder: { status: "unresolved", participantRef: null },
        outcome: "not_seconded",
        votes: [],
      },
    ],
  };
}

function motion(
  text: string,
  mover: string,
  seconder: string,
  outcome: "carried" | "failed" | "tabled",
  votes: MeetingDraft["motions"][number]["votes"] = [],
): MeetingDraft["motions"][number] {
  return {
    text,
    mover: { status: "resolved", participantRef: mover },
    seconder: { status: "resolved", participantRef: seconder },
    outcome,
    votes,
  };
}

async function selectRows(
  table: string,
  column: string,
  value: string,
  select: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    throw new Error(`Local Supabase query for ${table} failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<Record<string, unknown>[]>;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
