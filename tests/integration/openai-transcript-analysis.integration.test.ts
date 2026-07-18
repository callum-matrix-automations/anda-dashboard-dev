import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyzeMeetingTranscript } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import { MeetingDraftSchema } from "../../src/shared/contracts/meetingAnalysis";
import { TranscriptWebhookPacketSchema } from "../../src/shared/contracts/transcriptWebhook";

const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!openAiConfigured)("live OpenAI transcript analysis", () => {
  it("turns the long dummy transcript into the planned meeting JSON", async () => {
    const [packetJson, transcriptContent] = await Promise.all([
      readFile("fixtures/transcripts/dummy-transcript-packet.json", "utf8"),
      readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8"),
    ]);
    const packetMetadata = JSON.parse(packetJson) as Record<string, unknown> & {
      occurredAt: string;
      transcript: Record<string, unknown>;
    };
    const packet = TranscriptWebhookPacketSchema.parse({
      ...packetMetadata,
      sentAt: packetMetadata.occurredAt,
      transcript: {
        ...packetMetadata.transcript,
        content: transcriptContent,
      },
    });

    const draft = await analyzeMeetingTranscript({
      meeting: {
        sourceMeetingId: packet.meeting.sourceMeetingId,
        title: packet.meeting.title,
        meetingDate: packet.meeting.startedAt.slice(0, 10),
        durationMinutes: packet.meeting.durationMinutes,
      },
      transcript: {
        language: packet.transcript.language,
        content: packet.transcript.content,
      },
      participants: [
        { participantRef: "10000000-0000-4000-8000-000000000001", displayName: "Eleanor Hughes" },
        { participantRef: "10000000-0000-4000-8000-000000000002", displayName: "Marcus Patel" },
        { participantRef: "10000000-0000-4000-8000-000000000003", displayName: "Priya Shah" },
        { participantRef: "10000000-0000-4000-8000-000000000004", displayName: "Daniel Brooks" },
        { participantRef: "10000000-0000-4000-8000-000000000005", displayName: "Amelia Clarke" },
      ],
    });

    expect(MeetingDraftSchema.safeParse(draft).success).toBe(true);
    expect(draft.attendees).toHaveLength(5);
    expect(draft.motions.map((motion) => motion.outcome)).toEqual(expect.arrayContaining([
      "carried",
      "failed",
      "tabled",
      "unresolved",
    ]));
    expect(draft.motions.some((motion) => motion.seconder.status === "unresolved")).toBe(true);

    process.stdout.write(`\nValidated GPT-4.1 meeting analysis:\n${JSON.stringify(draft, null, 2)}\n\n`);
  }, 90_000);
});
