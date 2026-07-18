import { describe, expect, it, vi } from "vitest";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import type { TranscriptRepository } from "../../src/backend/repositories/transcripts/transcriptRepository";
import type { TranscriptWebhookPacket } from "../../src/shared/contracts/transcriptWebhook";

const packet: TranscriptWebhookPacket = {
  eventId: "evt_store_test_001",
  eventType: "transcript.ready",
  occurredAt: "2026-07-18T23:45:00-04:00",
  sentAt: "2026-07-19T03:46:00.000Z",
  meeting: {
    sourceMeetingId: "meeting_store_test_001",
    title: "Late evening board meeting",
    startedAt: "2026-07-18T23:00:00-04:00",
    endedAt: "2026-07-18T23:45:00-04:00",
    durationMinutes: 45,
  },
  attendees: [
    { displayName: "  Eleanor   Hughes " },
    { displayName: "Unknown Guest" },
  ],
  transcript: {
    sourceTranscriptId: "transcript_store_test_001",
    contentType: "text/plain",
    language: "en-US",
    content: "Chair: Preserve this source transcript exactly.\nSecretary: Confirmed.",
  },
};

describe("storeTranscriptImport", () => {
  it("maps the provider-neutral webhook packet to the repository record", async () => {
    const listActiveMemberProfiles = vi.fn().mockResolvedValue([{
      profileId: "10000000-0000-4000-8000-000000000001",
      displayName: "Eleanor Hughes",
    }]);
    const storeImport = vi.fn().mockResolvedValue({
      status: "stored",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-19T03:46:01.000Z",
    });
    const repository: TranscriptRepository = { listActiveMemberProfiles, storeImport };

    await createTranscriptImportStore(repository)(packet);

    expect(storeImport).toHaveBeenCalledWith({
      sourceMeetingId: "meeting_store_test_001",
      title: "Late evening board meeting",
      meetingDate: "2026-07-18",
      durationMinutes: 45,
      sourceTranscriptId: "transcript_store_test_001",
      content: "Chair: Preserve this source transcript exactly.\nSecretary: Confirmed.",
      attendees: [{
        profileId: "10000000-0000-4000-8000-000000000001",
        displayNameSnapshot: "Eleanor Hughes",
      }],
    });
    expect(listActiveMemberProfiles).toHaveBeenCalledOnce();
  });
});
