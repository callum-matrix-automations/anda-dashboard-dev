import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/webhooks/transcripts/route";
import { createTranscriptWebhookHandler } from "../../src/backend/integrations/webhooks/transcriptWebhookHandler";
import {
  createTranscriptWebhookSignature,
  TRANSCRIPT_SIGNATURE_HEADER,
  TRANSCRIPT_TIMESTAMP_HEADER,
} from "../../src/backend/integrations/webhooks/transcriptWebhookAuth";
import { MAX_TRANSCRIPT_WEBHOOK_BYTES } from "../../src/shared/contracts/transcriptWebhook";

const secret = "test-transcript-webhook-secret";
const validPacket = {
  eventId: "evt_api_test_001",
  eventType: "transcript.ready",
  occurredAt: "2026-07-18T17:41:00.000Z",
  sentAt: "2026-07-18T18:00:00.000Z",
  meeting: {
    sourceMeetingId: "meeting_api_test_001",
    title: "Test meeting",
    startedAt: "2026-07-18T17:00:00.000Z",
    endedAt: "2026-07-18T17:41:00.000Z",
    durationMinutes: 41,
  },
  attendees: [
    { displayName: "Eleanor Hughes" },
    { displayName: "Marcus Patel" },
  ],
  transcript: {
    sourceTranscriptId: "transcript_api_test_001",
    contentType: "text/plain",
    language: "en-GB",
    content: "Chair: The meeting is called to order.",
  },
};

beforeEach(() => { process.env.TRANSCRIPT_WEBHOOK_SECRET = secret; });
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.TRANSCRIPT_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/transcripts", () => {
  it("receives an authenticated packet and handles a duplicate idempotently", async () => {
    const receive = vi.fn()
      .mockResolvedValueOnce({
        status: "received" as const,
        eventId: validPacket.eventId,
        sourceMeetingId: validPacket.meeting.sourceMeetingId,
        sourceTranscriptId: validPacket.transcript.sourceTranscriptId,
        transcriptCharacters: validPacket.transcript.content.length,
        attempts: 1,
        receivedAt: "2026-07-18T18:01:00.000Z",
      })
      .mockResolvedValueOnce({
        status: "duplicate" as const,
        eventId: validPacket.eventId,
        sourceMeetingId: validPacket.meeting.sourceMeetingId,
        sourceTranscriptId: validPacket.transcript.sourceTranscriptId,
        attempts: 0 as const,
        firstReceivedAt: "2026-07-18T18:01:00.000Z",
      });
    const post = createTranscriptWebhookHandler(receive);
    const rawBody = JSON.stringify(validPacket);
    const first = await post(signedRequest(rawBody));
    const firstReceipt = await first.json();
    const duplicate = await post(signedRequest(rawBody));

    expect(first.status).toBe(202);
    expect(firstReceipt).toMatchObject({ status: "received", attempts: 1 });
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ status: "duplicate", attempts: 0 });
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledWith(validPacket);
  });

  it("maps an exhausted backend workflow to a retryable webhook failure", async () => {
    const receive = vi.fn().mockResolvedValue({
      status: "failed" as const,
      eventId: validPacket.eventId,
      sourceMeetingId: validPacket.meeting.sourceMeetingId,
      sourceTranscriptId: validPacket.transcript.sourceTranscriptId,
      attempts: 4,
      failedAt: "2026-07-18T18:01:00.000Z",
      error: { code: "receive_failed" as const, message: "Transcript receipt failed after three retries." },
    });
    const post = createTranscriptWebhookHandler(receive);

    const response = await post(signedRequest(JSON.stringify(validPacket)));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "failed", attempts: 4 });
  });

  it("preserves leading and trailing transcript whitespace after validation", async () => {
    const content = "\n  Chair: Preserve the original spacing.\r\nSecretary: Confirmed.  \n";
    const packet = {
      ...validPacket,
      eventId: "evt_preserve_whitespace",
      transcript: { ...validPacket.transcript, sourceTranscriptId: "transcript_whitespace", content },
    };
    const receive = vi.fn().mockResolvedValue({
      status: "received" as const,
      eventId: packet.eventId,
      sourceMeetingId: packet.meeting.sourceMeetingId,
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      transcriptCharacters: content.length,
      attempts: 1,
      receivedAt: "2026-07-18T18:01:00.000Z",
    });
    const post = createTranscriptWebhookHandler(receive);

    const response = await post(signedRequest(JSON.stringify(packet)));

    expect(response.status).toBe(202);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      transcript: expect.objectContaining({ content }),
    }));
  });

  it("rejects a missing signature", async () => {
    const response = await POST(new Request("https://anda.test/api/webhooks/transcripts", {
      method: "POST",
      body: JSON.stringify({ ...validPacket, eventId: "evt_missing_signature" }),
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_signature" });
  });

  it("rejects an expired signature", async () => {
    const rawBody = JSON.stringify({ ...validPacket, eventId: "evt_expired_signature" });
    const response = await POST(signedRequest(rawBody, String(Math.floor(Date.now() / 1_000) - 600)));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_signature" });
  });

  it("rejects an incorrect signature", async () => {
    const rawBody = JSON.stringify({ ...validPacket, eventId: "evt_incorrect_signature" });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const response = await POST(new Request("https://anda.test/api/webhooks/transcripts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [TRANSCRIPT_TIMESTAMP_HEADER]: timestamp,
        [TRANSCRIPT_SIGNATURE_HEADER]: createTranscriptWebhookSignature("incorrect-secret", timestamp, rawBody),
      },
      body: rawBody,
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_signature" });
  });

  it("rejects invalid JSON after authentication", async () => {
    const response = await POST(signedRequest("{not-json"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "invalid_json" });
  });

  it("rejects packets that do not match the contract", async () => {
    const rawBody = JSON.stringify({ ...validPacket, eventId: "evt_invalid_contract", transcript: { ...validPacket.transcript, content: "" } });
    const response = await POST(signedRequest(rawBody));
    expect(response.status).toBe(422);
  });

  it("rejects a missing or invalid meeting duration", async () => {
    const rawBody = JSON.stringify({
      ...validPacket,
      eventId: "evt_invalid_duration",
      meeting: { ...validPacket.meeting, durationMinutes: 0 },
    });
    const response = await POST(signedRequest(rawBody));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: "meeting.durationMinutes" })]),
    });
  });

  it("rejects duplicate attendee names after case and whitespace normalization", async () => {
    const rawBody = JSON.stringify({
      ...validPacket,
      eventId: "evt_duplicate_attendees",
      attendees: [
        { displayName: "Eleanor Hughes" },
        { displayName: "  ELEANOR   HUGHES " },
      ],
    });
    const response = await POST(signedRequest(rawBody));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: "attendees.1.displayName" })]),
    });
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

function signedRequest(body: string, timestamp = String(Math.floor(Date.now() / 1_000))): Request {
  return new Request("https://anda.test/api/webhooks/transcripts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TRANSCRIPT_TIMESTAMP_HEADER]: timestamp,
      [TRANSCRIPT_SIGNATURE_HEADER]: createTranscriptWebhookSignature(secret, timestamp, body),
    },
    body,
  });
}
