import { describe, expect, it, vi } from "vitest";
import {
  buildDummyTranscriptPacket,
  createDummyTranscriptSignature,
  sendDummyTranscript,
} from "../../scripts/mock-transcript/send-dummy-transcript.mjs";

const signingKey = Buffer.from("read-ai-dummy-test-signing-key-32").toString("base64");

describe("Read AI dummy transcript sender", () => {
  it("combines the pre-made meeting data and transcript into Read AI speaker blocks", async () => {
    const packet = await buildDummyTranscriptPacket();

    expect(packet).toMatchObject({
      session_id: "01KREADAIBOARD20260725001",
      trigger: "meeting_end",
      platform: "teams",
      platform_meeting_id: "anda-board-2026-07-25",
    });
    expect(packet.participants).toHaveLength(5);
    expect(packet.participants.slice(0, 2)).toEqual([
      expect.objectContaining({ name: "Eleanor Hughes", email: "eleanor.hughes@example.test" }),
      expect.objectContaining({ name: "Marcus Patel", email: "marcus.patel@example.test" }),
    ]);
    expect(packet.transcript.speaker_blocks.length).toBeGreaterThan(100);
    const content = packet.transcript.speaker_blocks.map((block) => block.words).join("\n");
    expect(content.length).toBeGreaterThan(12_000);
    expect(content).toContain("The motion is carried");
    expect(content).toContain("The motion is failed");
    expect(content).toContain("motion is tabled");
    expect(content).toContain("motion remains unresolved");
  });

  it("allows HTTP delivery to the local Next.js server", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    await expect(sendDummyTranscript({
      endpoint: "http://localhost:3000/api/webhooks/transcripts",
      signingKey,
      fetchImplementation,
    })).resolves.toMatchObject({ status: 202 });
  });

  it("rejects remote non-HTTPS endpoints before making a request", async () => {
    const fetchImplementation = vi.fn();
    await expect(sendDummyTranscript({
      endpoint: "http://webhook.example.test/transcripts",
      signingKey,
      fetchImplementation,
    })).rejects.toThrow("must use HTTPS unless it is a local loopback address");
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("posts the complete Read AI packet with the provider signature", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: true }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    const result = await sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      signingKey,
      fetchImplementation,
    });

    expect(result.status).toBe(202);
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url.href).toBe("https://webhook.example.test/transcripts");
    expect(request.method).toBe("POST");
    expect(request.headers["x-read-signature"]).toBe(
      createDummyTranscriptSignature(signingKey, request.body),
    );
    expect(JSON.parse(request.body).transcript.speaker_blocks.length).toBeGreaterThan(100);
  });

  it("surfaces non-successful webhook responses", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "receiver unavailable" }),
      { status: 503 },
    ));
    await expect(sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      signingKey,
      fetchImplementation,
    })).rejects.toThrow("HTTP 503");
  });

  it("requires a Read AI signing key before delivery", async () => {
    await expect(sendDummyTranscript({
      endpoint: "https://webhook.example.test/transcripts",
      signingKey: "",
      fetchImplementation: vi.fn(),
    })).rejects.toThrow("READ_AI_WEBHOOK_SIGNING_KEY");
  });
});
