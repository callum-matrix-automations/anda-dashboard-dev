import { describe, expect, it, vi } from "vitest";
import {
  createMeetingTranscriptAnalyzer,
  MEETING_ANALYSIS_INSTRUCTIONS,
  MEETING_ANALYSIS_SCHEMA_NAME,
} from "../../src/backend/services/ai/analyzeMeetingTranscript";
import {
  MEETING_DRAFT_JSON_SCHEMA,
  type MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";

const input = {
  meeting: {
    sourceMeetingId: "meeting_001",
    title: "ANDA Board Meeting",
    meetingDate: "2026-07-25",
    durationMinutes: 90,
  },
  transcript: {
    language: "en-GB",
    content: "Eleanor Hughes: I move to approve. Marcus Patel: I second. The motion carried.",
  },
  participants: [
    { participantRef: "profile_001", displayName: "Eleanor Hughes" },
    { participantRef: "profile_002", displayName: "Marcus Patel" },
  ],
};

describe("analyzeMeetingTranscript", () => {
  it("returns a validated draft from a schema-constrained OpenAI response", async () => {
    const draft = validDraft();
    const createStructuredResponse = vi.fn().mockResolvedValue(openAiResponse(draft));
    const analyze = createMeetingTranscriptAnalyzer({ createStructuredResponse });

    await expect(analyze(input)).resolves.toEqual(draft);
    expect(createStructuredResponse).toHaveBeenCalledOnce();
    const request = createStructuredResponse.mock.calls[0]![0];
    expect(request).toMatchObject({
      instructions: MEETING_ANALYSIS_INSTRUCTIONS,
      schemaName: MEETING_ANALYSIS_SCHEMA_NAME,
      schema: MEETING_DRAFT_JSON_SCHEMA,
      maxOutputTokens: 8_000,
    });
    expect(JSON.parse(request.input)).toEqual({
      meeting: input.meeting,
      allowedParticipants: input.participants,
      transcript: input.transcript,
    });
  });

  it("rejects invalid input before calling OpenAI", async () => {
    const createStructuredResponse = vi.fn();
    const analyze = createMeetingTranscriptAnalyzer({ createStructuredResponse });

    await expect(analyze({ ...input, transcript: { ...input.transcript, content: "   " } }))
      .rejects.toMatchObject({ code: "invalid_analysis_input" });
    expect(createStructuredResponse).not.toHaveBeenCalled();
  });

  it("rejects an incomplete OpenAI response", async () => {
    const createStructuredResponse = vi.fn().mockResolvedValue({
      ...openAiResponse(validDraft()),
      status: "incomplete",
    });

    await expect(createMeetingTranscriptAnalyzer({ createStructuredResponse })(input))
      .rejects.toMatchObject({ code: "incomplete_analysis_response" });
  });

  it("rejects malformed response JSON", async () => {
    const createStructuredResponse = vi.fn().mockResolvedValue({
      ...openAiResponse(validDraft()),
      outputText: "not json",
    });

    await expect(createMeetingTranscriptAnalyzer({ createStructuredResponse })(input))
      .rejects.toMatchObject({ code: "invalid_analysis_json" });
  });

  it("rejects a response that violates the draft contract", async () => {
    const invalidDraft = { ...validDraft(), schemaVersion: "2.0" };
    const createStructuredResponse = vi.fn().mockResolvedValue(openAiResponse(invalidDraft));

    await expect(createMeetingTranscriptAnalyzer({ createStructuredResponse })(input))
      .rejects.toMatchObject({ code: "invalid_analysis_output" });
  });

  it("rejects invented participant references or changed display names", async () => {
    const draft = validDraft();
    draft.attendees[1] = { participantRef: "profile_999", displayName: "Invented Person" };
    const createStructuredResponse = vi.fn().mockResolvedValue(openAiResponse(draft));

    await expect(createMeetingTranscriptAnalyzer({ createStructuredResponse })(input))
      .rejects.toMatchObject({ code: "invalid_analysis_output" });
  });

  it("rejects an analysis that omits a supplied attendee", async () => {
    const draft = validDraft();
    draft.attendees = draft.attendees.slice(0, 1);
    draft.motions[0]!.seconder = { status: "unresolved", participantRef: null };
    const createStructuredResponse = vi.fn().mockResolvedValue(openAiResponse(draft));

    await expect(createMeetingTranscriptAnalyzer({ createStructuredResponse })(input))
      .rejects.toMatchObject({ code: "invalid_analysis_output" });
  });
});

function validDraft(): MeetingDraft {
  return {
    schemaVersion: "1.0",
    minutes: {
      summary: "The board approved the motion.",
      sections: [{ heading: "Decision", content: "The motion was moved, seconded, and carried." }],
    },
    attendees: [
      { participantRef: "profile_001", displayName: "Eleanor Hughes" },
      { participantRef: "profile_002", displayName: "Marcus Patel" },
    ],
    motions: [{
      text: "Approve the proposal.",
      mover: { status: "resolved", participantRef: "profile_001" },
      seconder: { status: "resolved", participantRef: "profile_002" },
      outcome: "carried",
      votes: [],
    }],
  };
}

function openAiResponse(draft: unknown) {
  return {
    responseId: "resp_analysis_001",
    model: "gpt-4.1-2025-04-14",
    status: "completed",
    outputText: JSON.stringify(draft),
  };
}
