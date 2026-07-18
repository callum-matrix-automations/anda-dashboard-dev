import { describe, expect, it, vi } from "vitest";
import {
  buildDummyTranscriptPacket,
  createDummyTranscriptSignature,
  sendDummyTranscript,
} from "../../scripts/mock-transcript/send-dummy-transcript.mjs";

const fixedNow = () => new Date("2026-07-18T18:00:00.000Z");
const secret = "test-transcript-webhook-secret";

describe("dummy transcript sender", () => {
  it("combines the pre-made metadata and transcript fixtures", async () => {
    const packet = await buildDummyTranscriptPacket({ now: fixedNow });

    expect(packet).toMatchObject({
      eventId: "evt_anda_mock_20260725_001",
      eventType: "transcript.ready",
      sentAt: "2026-07-18T18:00:00.000Z",
      meeting: {
        sourceMeetingId: "anda-board-2026-07-25",
        durationMinutes: 90,
      },
      attendees: [
        { displayName: "Eleanor Hughes" },
        { displayName: "Marcus Patel" },
        { displayName: "Priya Shah" },
        { displayName: "Daniel Brooks" },
        { displayName: "Amelia Clarke" },
      ],
      transcript: {
        sourceTranscriptId: "anda-transcript-2026-07-25",
        contentType: "text/plain",
        language: "en-GB",
      },
    });
    expect(packet.transcript.content.length).toBeGreaterThan(12_000);
    expect(packet.transcript.content).toContain("The motion is carried");
    expect(packet.transcript.content).toContain("The motion is failed");
    expect(packet.transcript.content).toContain("motion is tabled");
    expect(packet.transcript.content).toContain("motion remains unresolved");
  });

  it("allows HTTP delivery to the local Next.js server", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));

    await expect(sendDummyTranscript({
      endpoint: "http://localhost:3000/api/webhooks/transcripts",
      secret,
      fetchImplementation,
      now: fixedNow,
    })).resolves.toMatchObject({ status: 202 });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("rejects remote non-HTTPS endpoints before making a request", async () => {
    const fetchImplementation = vi.fn();

    await expect(sendDummyTranscript({
      endpoint: "http://webhook.example.test/transcripts",
      secret,
      fetchImplementation,
    })).rejects.toThrow("must use HTTPS unless it is a local loopback address");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("posts the complete data packet as JSON over HTTPS", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: true }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));

    const result = await sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      secret,
      fetchImplementation,
      now: fixedNow,
    });

    expect(result.status).toBe(202);
    expect(result.responseBody).toEqual({ accepted: true });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url.href).toBe("https://webhook.example.test/transcripts");
    expect(request.method).toBe("POST");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-anda-event-id"]).toBe("evt_anda_mock_20260725_001");
    expect(request.headers["x-anda-webhook-timestamp"]).toBe("1784397600");
    expect(request.headers["x-anda-webhook-signature"]).toBe(
      createDummyTranscriptSignature(secret, "1784397600", request.body),
    );
    expect(JSON.parse(request.body).transcript.content).toContain("monthly ANDA board meeting");
  });

  it("surfaces non-successful webhook responses", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "receiver unavailable" }),
      { status: 503 },
    ));

    await expect(sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      secret,
      fetchImplementation,
      now: fixedNow,
    })).rejects.toThrow("HTTP 503");
  });

  it("requires a webhook secret before delivery", async () => {
    await expect(sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      secret: "",
      fetchImplementation: vi.fn(),
    })).rejects.toThrow("TRANSCRIPT_WEBHOOK_SECRET");
  });
});
