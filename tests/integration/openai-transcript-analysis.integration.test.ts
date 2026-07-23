import { describe, expect, it } from "vitest";
import { adaptReadAiWebhook } from "../../src/backend/integrations/read-ai/readAiTranscriptAdapter";
import { analyzeMeetingTranscript } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import { MeetingDraftSchema } from "../../src/shared/contracts/meetingAnalysis";
import { createUniqueReadAiPayload } from "./pre-approval-workflow.helpers";

const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!openAiConfigured)("live OpenAI transcript analysis", () => {
  it("turns the long dummy transcript into the planned meeting JSON", async () => {
    const payload = await createUniqueReadAiPayload("live-openai-analysis");
    const adapted = adaptReadAiWebhook(payload);
    if (adapted.status !== "ready") throw new Error("The meeting_end fixture was unexpectedly ignored.");
    const packet = adapted.packet;

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
      "not_seconded",
    ]));
    expect(draft.motions.some((motion) => motion.seconder.status === "unresolved")).toBe(true);

    process.stdout.write(`\nValidated GPT-5.6 Terra meeting analysis:\n${JSON.stringify(draft, null, 2)}\n\n`);
  }, 90_000);
});
