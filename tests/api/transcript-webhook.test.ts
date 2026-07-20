import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/webhooks/transcripts/route";
import { createTranscriptWebhookHandler } from "../../src/backend/integrations/webhooks/transcriptWebhookHandler";
import {
  createReadAiWebhookSignature,
  READ_AI_SIGNATURE_HEADER,
} from "../../src/backend/integrations/webhooks/transcriptWebhookAuth";
import { MAX_TRANSCRIPT_WEBHOOK_BYTES } from "../../src/shared/contracts/transcriptWebhook";

const signingKey = Buffer.from("read-ai-test-signing-key-material-32").toString("base64");
const validPayload = {
  session_id: "01READAISESSIONTEST001",
  trigger: "meeting_end" as const,
  title: "Test meeting",
  start_time: "2026-07-18T17:00:00.000Z",
  end_time: "2026-07-18T17:41:30.000Z",
  participants: [
    { name: "Eleanor Hughes", first_name: "Eleanor", last_name: "Hughes", email: "eleanor@example.test" },
    { name: "Marcus Patel", first_name: "Marcus", last_name: "Patel", email: null },
  ],
  owner: { name: "Eleanor Hughes", first_name: "Eleanor", last_name: "Hughes", email: "eleanor@example.test" },
  summary: "Provider summary",
  action_items: [{ text: "Provider action" }],
  key_questions: [{ text: "Provider question?" }],
  topics: [{ text: "Governance" }],
  report_url: "https://app.read.ai/analytics/meetings/01READAISESSIONTEST001",
  chapter_summaries: [{ title: "Opening", description: "Opening business", topics: [{ text: "Governance" }] }],
  transcript: {
    speaker_blocks: [
      { start_time: "1752858060000", end_time: "1752858065000", speaker: { name: "Marcus Patel" }, words: "Minutes confirmed." },
      { start_time: "1752858000000", end_time: "1752858005000", speaker: { name: "Eleanor Hughes" }, words: "Meeting opened." },
    ],
    speakers: [{ name: "Eleanor Hughes" }, { name: "Marcus Patel" }],
  },
  platform_meeting_id: "teams-meeting-test-001",
  platform: "teams",
  request_id: "01READAIREQUESTTEST001",
  additive_future_field: "accepted",
};

beforeEach(() => { process.env.READ_AI_WEBHOOK_SIGNING_KEY = signingKey; });
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.READ_AI_WEBHOOK_SIGNING_KEY;
});

describe("POST /api/webhooks/transcripts", () => {
  it("authenticates and adapts a Read AI meeting_end packet", async () => {
    const receive = vi.fn().mockResolvedValue({
      status: "received" as const,
      eventId: validPayload.request_id,
      sourceMeetingId: `read_ai:${validPayload.session_id}`,
      sourceTranscriptId: `read_ai:${validPayload.session_id}`,
      transcriptCharacters: 57,
      attempts: 1,
      receivedAt: "2026-07-18T18:01:00.000Z",
    });
    const post = createTranscriptWebhookHandler(receive, {
      recordFailure: vi.fn(),
      now: () => new Date("2026-07-18T18:01:00.000Z"),
    });

    const response = await post(signedRequest(JSON.stringify(validPayload)));

    expect(response.status).toBe(202);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      eventId: validPayload.request_id,
      meeting: expect.objectContaining({
        sourceMeetingId: `read_ai:${validPayload.session_id}`,
        durationMinutes: 42,
      }),
      attendees: [
        { displayName: "Eleanor Hughes", email: "eleanor@example.test" },
        { displayName: "Marcus Patel", email: null },
      ],
      transcript: expect.objectContaining({
        sourceTranscriptId: `read_ai:${validPayload.session_id}`,
        language: "und",
        content: "Eleanor Hughes: Meeting opened.\nMarcus Patel: Minutes confirmed.",
        metadata: expect.objectContaining({ provider: "read_ai" }),
      }),
    }));
  });

  it("acknowledges meeting_start without invoking transcript receipt", async () => {
    const receive = vi.fn();
    const startPayload = {
      session_id: "01READAISTART001",
      trigger: "meeting_start",
      title: "Starting meeting",
      start_time: "2026-07-18T17:00:00.000Z",
      owner: validPayload.owner,
      platform: "teams",
      platform_meeting_id: "teams-start-001",
      request_id: "01READAISTARTREQUEST001",
    };
    const response = await createTranscriptWebhookHandler(receive, { recordFailure: vi.fn() })(
      signedRequest(JSON.stringify(startPayload)),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ignored",
      eventId: startPayload.request_id,
      reason: "meeting_start",
    });
    expect(receive).not.toHaveBeenCalled();
  });

  it("maps an exhausted backend workflow to a retryable response", async () => {
    const receive = vi.fn().mockResolvedValue({
      status: "failed" as const,
      eventId: validPayload.request_id,
      sourceMeetingId: `read_ai:${validPayload.session_id}`,
      sourceTranscriptId: `read_ai:${validPayload.session_id}`,
      attempts: 4,
      failedAt: "2026-07-18T18:01:00.000Z",
      error: { code: "receive_failed" as const, message: "Transcript receipt failed after three retries." },
    });
    const response = await createTranscriptWebhookHandler(receive, { recordFailure: vi.fn() })(
      signedRequest(JSON.stringify(validPayload)),
    );
    expect(response.status).toBe(503);
  });

  it("rejects missing, malformed, and incorrect signatures", async () => {
    const body = JSON.stringify(validPayload);
    const missing = await POST(new Request("https://anda.test/api/webhooks/transcripts", { method: "POST", body }));
    const malformed = await POST(new Request("https://anda.test/api/webhooks/transcripts", {
      method: "POST",
      headers: { [READ_AI_SIGNATURE_HEADER]: "not-hex" },
      body,
    }));
    const incorrect = await POST(new Request("https://anda.test/api/webhooks/transcripts", {
      method: "POST",
      headers: {
        [READ_AI_SIGNATURE_HEADER]: createReadAiWebhookSignature(
          Buffer.from("different-read-ai-signing-key-32").toString("base64"),
          body,
        ),
      },
      body,
    }));
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it("rejects invalid JSON after authentication", async () => {
    const response = await POST(signedRequest("{not-json"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_json" });
  });

  it("records identifiable invalid and empty-transcript imports", async () => {
    const recordFailure = vi.fn().mockResolvedValue(undefined);
    const post = createTranscriptWebhookHandler(vi.fn(), { recordFailure });
    const missingTranscript = { ...validPayload, transcript: undefined };
    const emptyTranscript = {
      ...validPayload,
      request_id: "01READAIEMPTY001",
      transcript: { ...validPayload.transcript, speaker_blocks: [] },
    };

    const invalidResponse = await post(signedRequest(JSON.stringify(missingTranscript)));
    const emptyResponse = await post(signedRequest(JSON.stringify(emptyTranscript)));

    expect(invalidResponse.status).toBe(422);
    expect(emptyResponse.status).toBe(422);
    expect(recordFailure).toHaveBeenCalledTimes(2);
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({
      sourceMeetingId: `read_ai:${validPayload.session_id}`,
      errorCode: "invalid_read_ai_payload",
      attempts: 0,
    }));
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "empty_transcript" }));
  });

  it("rejects reversed meeting and speaker timestamps", async () => {
    const post = createTranscriptWebhookHandler(vi.fn(), { recordFailure: vi.fn() });
    const reversedMeeting = { ...validPayload, end_time: validPayload.start_time };
    const reversedBlock = {
      ...validPayload,
      transcript: {
        ...validPayload.transcript,
        speaker_blocks: [{
          ...validPayload.transcript.speaker_blocks[0],
          start_time: "1752858065000",
          end_time: "1752858060000",
        }],
      },
    };
    expect((await post(signedRequest(JSON.stringify(reversedMeeting)))).status).toBe(422);
    expect((await post(signedRequest(JSON.stringify(reversedBlock)))).status).toBe(422);
  });

  it("deduplicates participants by normalized email", async () => {
    const receive = vi.fn().mockResolvedValue({
      status: "received", eventId: validPayload.request_id,
      sourceMeetingId: `read_ai:${validPayload.session_id}`,
      sourceTranscriptId: `read_ai:${validPayload.session_id}`,
      transcriptCharacters: 1, attempts: 1, receivedAt: "2026-07-18T18:01:00.000Z",
    });
    const payload = {
      ...validPayload,
      participants: [
        validPayload.participants[0],
        { ...validPayload.participants[0], name: "Duplicate Name", email: " ELEANOR@example.test " },
        validPayload.participants[1],
      ],
    };
    const response = await createTranscriptWebhookHandler(receive, { recordFailure: vi.fn() })(
      signedRequest(JSON.stringify(payload)),
    );
    expect(response.status).toBe(202);
    expect(receive.mock.calls[0]?.[0].attendees).toHaveLength(2);
  });

  it("keeps people with the same display name when their emails are different", async () => {
    const receive = vi.fn().mockResolvedValue({
      status: "received" as const,
      eventId: validPayload.request_id,
      sourceMeetingId: `read_ai:${validPayload.session_id}`,
      sourceTranscriptId: `read_ai:${validPayload.session_id}`,
      transcriptCharacters: 1,
      attempts: 1,
      receivedAt: "2026-07-18T18:01:00.000Z",
    });
    const payload = {
      ...validPayload,
      participants: [
        { ...validPayload.participants[0], name: "Alex Morgan", email: "alex.one@example.test" },
        { ...validPayload.participants[1], name: "Alex Morgan", email: "alex.two@example.test" },
      ],
    };

    const response = await createTranscriptWebhookHandler(receive, { recordFailure: vi.fn() })(
      signedRequest(JSON.stringify(payload)),
    );

    expect(response.status).toBe(202);
    expect(receive.mock.calls[0]?.[0].attendees).toEqual([
      { displayName: "Alex Morgan", email: "alex.one@example.test" },
      { displayName: "Alex Morgan", email: "alex.two@example.test" },
    ]);
  });

  it("rejects oversized payloads", async () => {
    const response = await POST(new Request("https://anda.test/api/webhooks/transcripts", {
      method: "POST",
      headers: { "content-length": String(MAX_TRANSCRIPT_WEBHOOK_BYTES + 1) },
      body: "x",
    }));
    expect(response.status).toBe(413);
  });
});

function signedRequest(body: string): Request {
  return new Request("https://anda.test/api/webhooks/transcripts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [READ_AI_SIGNATURE_HEADER]: createReadAiWebhookSignature(signingKey, body),
    },
    body,
  });
}
