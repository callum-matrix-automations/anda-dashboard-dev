import { describe, expect, it, vi } from "vitest";
import { createTranscriptReceiver } from "../../src/backend/services/transcripts/receiveTranscript";
import type { TranscriptWebhookPacket } from "../../src/shared/contracts/transcriptWebhook";

const packet: TranscriptWebhookPacket = {
  eventId: "evt_test_001",
  eventType: "transcript.ready",
  occurredAt: "2026-07-18T17:41:00.000Z",
  sentAt: "2026-07-18T18:00:00.000Z",
  meeting: {
    sourceMeetingId: "meeting_test_001",
    title: "Test meeting",
    startedAt: "2026-07-18T17:00:00.000Z",
    endedAt: "2026-07-18T17:41:00.000Z",
    durationMinutes: 41,
  },
  attendees: [{ displayName: "Eleanor Hughes" }],
  transcript: {
    sourceTranscriptId: "transcript_test_001",
    contentType: "text/plain",
    language: "en-GB",
    content: "Chair: The meeting is called to order.",
  },
};

const fixedNow = () => new Date("2026-07-18T18:01:00.000Z");
const logger = () => ({ info: vi.fn(), error: vi.fn() });
const noDelay = vi.fn().mockResolvedValue(undefined);

describe("receiveTranscript", () => {
  it("acknowledges source references without returning transcript content", async () => {
    const testLogger = logger();
    const receive = createTranscriptReceiver({ now: fixedNow, logger: testLogger, delay: noDelay });
    const receipt = await receive(packet);

    expect(receipt).toEqual({
      status: "received",
      eventId: "evt_test_001",
      sourceMeetingId: "meeting_test_001",
      sourceTranscriptId: "transcript_test_001",
      transcriptCharacters: 38,
      attempts: 1,
      receivedAt: "2026-07-18T18:01:00.000Z",
    });
    expect(receipt).not.toHaveProperty("content");
  });

  it("returns duplicate without processing the same source transcript twice", async () => {
    const processTranscript = vi.fn().mockResolvedValue(undefined);
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay: noDelay });

    await receive(packet);
    const duplicate = await receive({ ...packet, eventId: "evt_test_retry" });

    expect(duplicate).toMatchObject({ status: "duplicate", attempts: 0, eventId: "evt_test_retry" });
    expect(processTranscript).toHaveBeenCalledOnce();
  });

  it("sends a conflicting same-ID replay to persistence instead of trusting the memory cache", async () => {
    const processTranscript = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("immutable transcript conflict"));
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay: noDelay });

    await receive(packet);
    const result = await receive({
      ...packet,
      eventId: "evt_conflicting_replay",
      transcript: { ...packet.transcript, content: "Chair: This content has changed." },
    });

    expect(result).toMatchObject({ status: "failed", attempts: 4 });
    expect(processTranscript).toHaveBeenCalledTimes(5);
  });

  it("does not treat changed duration or attendees as the same in-memory delivery", async () => {
    const processTranscript = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("source packet conflict"));
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay: noDelay });

    await receive(packet);
    const result = await receive({
      ...packet,
      eventId: "evt_changed_meeting_context",
      meeting: { ...packet.meeting, durationMinutes: 42 },
      attendees: [{ displayName: "Marcus Patel" }],
    });

    expect(result).toMatchObject({ status: "failed", attempts: 4 });
    expect(processTranscript).toHaveBeenCalledTimes(5);
  });

  it("recognizes a durable database duplicate after an application restart", async () => {
    const processTranscript = vi.fn().mockResolvedValue({
      status: "duplicate" as const,
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-18T17:45:00.000Z",
    });
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay: noDelay });

    await expect(receive(packet)).resolves.toEqual({
      status: "duplicate",
      eventId: packet.eventId,
      sourceMeetingId: packet.meeting.sourceMeetingId,
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      attempts: 0,
      firstReceivedAt: "2026-07-18T17:45:00.000Z",
    });
    expect(processTranscript).toHaveBeenCalledOnce();
  });

  it("uses the persisted import timestamp in a successful receipt", async () => {
    const processTranscript = vi.fn().mockResolvedValue({
      status: "stored" as const,
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-18T17:59:30.000Z",
    });
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay: noDelay });

    await expect(receive(packet)).resolves.toMatchObject({
      status: "received",
      receivedAt: "2026-07-18T17:59:30.000Z",
    });
  });

  it("recovers when the fourth attempt succeeds after three retries", async () => {
    const processTranscript = vi.fn()
      .mockRejectedValueOnce(new Error("attempt one"))
      .mockRejectedValueOnce(new Error("attempt two"))
      .mockRejectedValueOnce(new Error("attempt three"))
      .mockResolvedValueOnce(undefined);
    const delay = vi.fn().mockResolvedValue(undefined);
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: logger(), delay });

    await expect(receive(packet)).resolves.toMatchObject({ status: "received", attempts: 4 });
    expect(processTranscript).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledTimes(3);
  });

  it("returns and logs a failed result after three retries are exhausted", async () => {
    const testLogger = logger();
    const processTranscript = vi.fn().mockRejectedValue(new Error("receiver offline"));
    const delay = vi.fn().mockResolvedValue(undefined);
    const receive = createTranscriptReceiver({ processTranscript, now: fixedNow, logger: testLogger, delay });

    const result = await receive(packet);

    expect(result).toMatchObject({
      status: "failed",
      attempts: 4,
      error: { code: "receive_failed" },
    });
    expect(processTranscript).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledTimes(3);
    expect(testLogger.error).toHaveBeenCalledWith("Transcript webhook failed", expect.objectContaining({
      reason: "receiver offline",
    }));
  });
});
