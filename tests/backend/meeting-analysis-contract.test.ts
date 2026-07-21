import { describe, expect, it } from "vitest";
import {
  MeetingAnalysisInputSchema,
  MeetingDraftSchema,
  type MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";

describe("meeting analysis contracts", () => {
  it("preserves the source transcript while validating it is not blank", () => {
    const content = "  Chair: Keep this whitespace.\n";
    const parsed = MeetingAnalysisInputSchema.parse({
      meeting: {
        sourceMeetingId: "meeting_001",
        title: "Board meeting",
        meetingDate: "2026-07-25",
        durationMinutes: 90,
      },
      transcript: { language: "en-GB", content },
      participants: [],
    });

    expect(parsed.transcript.content).toBe(content);
  });

  it("rejects inconsistent unresolved participant resolutions", () => {
    const draft = createDraft();
    draft.motions[0]!.seconder = {
      status: "unresolved",
      participantRef: "profile_002",
    } as never;

    expect(MeetingDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects motion identities and votes outside the draft attendee list", () => {
    const draft = createDraft();
    draft.motions[0]!.votes = [{ participantRef: "profile_999", value: "for" }];

    expect(MeetingDraftSchema.safeParse(draft).success).toBe(false);
  });

  it("accepts a not-seconded motion only without a resolved seconder", () => {
    const draft = createDraft();
    draft.motions[0]!.outcome = "not_seconded";
    expect(MeetingDraftSchema.safeParse(draft).success).toBe(true);

    draft.motions[0]!.seconder = { status: "resolved", participantRef: "profile_002" };
    expect(MeetingDraftSchema.safeParse(draft).success).toBe(false);
  });
});

function createDraft(): MeetingDraft {
  return {
    schemaVersion: "1.0" as const,
    minutes: {
      summary: "The board considered the agenda.",
      sections: [{ heading: "Opening", content: "The chair opened the meeting." }],
    },
    attendees: [
      { participantRef: "profile_001", displayName: "Eleanor Hughes" },
      { participantRef: "profile_002", displayName: "Marcus Patel" },
    ],
    motions: [{
      text: "Approve the minutes.",
      mover: { status: "resolved" as const, participantRef: "profile_001" },
      seconder: { status: "unresolved" as const, participantRef: null },
      outcome: "carried" as const,
      votes: [{ participantRef: "profile_001", value: "for" as const }],
    }],
  };
}
