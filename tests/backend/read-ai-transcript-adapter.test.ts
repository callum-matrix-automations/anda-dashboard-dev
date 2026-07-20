import { describe, expect, it } from "vitest";
import {
  adaptReadAiWebhook,
  ReadAiTranscriptAdapterError,
} from "../../src/backend/integrations/read-ai/readAiTranscriptAdapter";
import {
  ReadAiMeetingEndWebhookSchema,
  ReadAiMeetingStartWebhookSchema,
} from "../../src/shared/contracts/readAiWebhook";

const meetingEnd = ReadAiMeetingEndWebhookSchema.parse({
  session_id: "read-session-001",
  trigger: "meeting_end",
  title: " Read AI adapter meeting ",
  start_time: "2026-07-20T09:00:00.000Z",
  end_time: "2026-07-20T10:00:01.000Z",
  participants: [
    { name: " Eleanor   Hughes ", email: "ELEANOR@example.test" },
    { name: "Duplicate Eleanor", email: "eleanor@example.test" },
    { name: " Marcus Patel ", email: null },
    { name: "marcus   patel" },
  ],
  owner: { name: "Eleanor Hughes", email: "eleanor@example.test" },
  summary: "Provider-generated summary",
  action_items: [{ text: "Provider action" }],
  key_questions: [{ text: "Provider question" }],
  topics: [{ text: "Governance" }],
  report_url: "https://app.read.ai/analytics/meetings/read-session-001",
  chapter_summaries: [{
    title: "Opening",
    description: "Opening business",
    topics: [{ text: "Governance" }],
  }],
  transcript: {
    speaker_blocks: [
      {
        start_time: "2000",
        end_time: "2500",
        speaker: { name: "Marcus Patel" },
        words: " Second line. ",
      },
      {
        start_time: 1000,
        end_time: 1500,
        speaker: { name: "Eleanor Hughes" },
        words: " First line. ",
      },
      {
        start_time: "3000",
        end_time: "3500",
        speaker: { name: "Eleanor Hughes" },
        words: "   ",
      },
    ],
    speakers: [{ name: "Eleanor Hughes" }, { name: "Marcus Patel" }],
  },
  platform_meeting_id: "teams-meeting-001",
  platform: "teams",
  request_id: "read-request-001",
});

describe("Read AI transcript adapter", () => {
  it("maps, orders, deduplicates and preserves a completed Read AI meeting", () => {
    const result = adaptReadAiWebhook(meetingEnd, {
      receivedAt: () => new Date("2026-07-20T10:00:02.000Z"),
    });

    expect(result).toEqual({
      status: "ready",
      packet: expect.objectContaining({
        eventId: "read-request-001",
        occurredAt: "2026-07-20T10:00:01.000Z",
        sentAt: "2026-07-20T10:00:02.000Z",
        meeting: {
          sourceMeetingId: "read_ai:read-session-001",
          title: "Read AI adapter meeting",
          startedAt: "2026-07-20T09:00:00.000Z",
          endedAt: "2026-07-20T10:00:01.000Z",
          durationMinutes: 61,
        },
        attendees: [
          { displayName: "Eleanor Hughes", email: "eleanor@example.test" },
          { displayName: "Marcus Patel", email: null },
        ],
        transcript: expect.objectContaining({
          sourceTranscriptId: "read_ai:read-session-001",
          content: "Eleanor Hughes: First line.\nMarcus Patel: Second line.",
          language: "und",
          metadata: expect.objectContaining({
            provider: "read_ai",
            requestId: "read-request-001",
            sessionId: "read-session-001",
            summary: "Provider-generated summary",
          }),
        }),
      }),
    });
  });

  it("acknowledges meeting_start without producing an import packet", () => {
    const start = ReadAiMeetingStartWebhookSchema.parse({
      session_id: "read-session-start",
      trigger: "meeting_start",
      title: "Starting meeting",
      start_time: "2026-07-20T09:00:00.000Z",
      owner: { name: "Eleanor Hughes" },
      platform: "teams",
      platform_meeting_id: "teams-start",
      request_id: "read-request-start",
    });

    expect(adaptReadAiWebhook(start)).toEqual({
      status: "ignored",
      eventId: "read-request-start",
      reason: "meeting_start",
    });
  });

  it("rejects invalid meeting timing", () => {
    expect(() => adaptReadAiWebhook({
      ...meetingEnd,
      end_time: meetingEnd.start_time,
    })).toThrowError(expect.objectContaining<Partial<ReadAiTranscriptAdapterError>>({
      code: "invalid_meeting_time",
    }));
  });

  it("rejects reversed speaker timing", () => {
    expect(() => adaptReadAiWebhook({
      ...meetingEnd,
      transcript: {
        ...meetingEnd.transcript,
        speaker_blocks: [{
          start_time: "2000",
          end_time: "1000",
          speaker: { name: "Eleanor Hughes" },
          words: "Invalid timing",
        }],
      },
    })).toThrowError(expect.objectContaining<Partial<ReadAiTranscriptAdapterError>>({
      code: "invalid_speaker_time",
    }));
  });

  it("rejects a completed event without transcript text", () => {
    expect(() => adaptReadAiWebhook({
      ...meetingEnd,
      transcript: {
        ...meetingEnd.transcript,
        speaker_blocks: [],
      },
    })).toThrowError(expect.objectContaining<Partial<ReadAiTranscriptAdapterError>>({
      code: "empty_transcript",
    }));
  });

  it("preserves a malformed participant email for safe unmatched handling", () => {
    const result = adaptReadAiWebhook({
      ...meetingEnd,
      participants: [{ name: "Unmatched Guest", email: "not-an-email" }],
    });

    expect(result).toMatchObject({
      status: "ready",
      packet: {
        attendees: [{ displayName: "Unmatched Guest", email: "not-an-email" }],
      },
    });
  });
});
