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
    { displayName: "  Source   Eleanor ", email: " ELEANOR.HUGHES@EXAMPLE.TEST " },
    { displayName: "Eleanor Hughes" },
    { displayName: "Unknown Guest", email: "unknown@example.test" },
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
      email: "eleanor.hughes@example.test",
    }]);
    const storeImport = vi.fn().mockResolvedValue({
      status: "stored",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-19T03:46:01.000Z",
    });
    const repository: TranscriptRepository = {
      listActiveMemberProfiles,
      storeImport,
      linkManualAttendees: vi.fn(),
      resolveUnmatchedParticipants: vi.fn(),
    };

    await createTranscriptImportStore(repository)(packet);

    expect(storeImport).toHaveBeenCalledWith({
      sourceMeetingId: "meeting_store_test_001",
      title: "Late evening board meeting",
      meetingDate: "2026-07-18",
      durationMinutes: 45,
      sourceTranscriptId: "transcript_store_test_001",
      content: "Chair: Preserve this source transcript exactly.\nSecretary: Confirmed.",
      metadata: {},
      attendees: [
        {
          profileId: "10000000-0000-4000-8000-000000000001",
          displayNameSnapshot: "Source Eleanor",
          sourceEmailSnapshot: "eleanor.hughes@example.test",
        },
        {
          profileId: null,
          displayNameSnapshot: "Eleanor Hughes",
          sourceEmailSnapshot: null,
        },
        {
          profileId: null,
          displayNameSnapshot: "Unknown Guest",
          sourceEmailSnapshot: "unknown@example.test",
        },
      ],
    });
    expect(listActiveMemberProfiles).toHaveBeenCalledOnce();
  });

  it("links uniquely named manual-upload speakers before analysis", async () => {
    const storeImport = vi.fn().mockResolvedValue({
      status: "stored",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-19T03:46:01.000Z",
    });
    const linkManualAttendees = vi.fn().mockResolvedValue(2);
    const repository: TranscriptRepository = {
      listActiveMemberProfiles: vi.fn().mockResolvedValue([
        {
          profileId: "10000000-0000-4000-8000-000000000001",
          displayName: "Eleanor Hughes",
          email: "eleanor.hughes@example.test",
        },
        {
          profileId: "10000000-0000-4000-8000-000000000002",
          displayName: "Marcus Patel",
          email: "marcus.patel@example.test",
        },
      ]),
      storeImport,
      linkManualAttendees,
      resolveUnmatchedParticipants: vi.fn(),
    };

    await createTranscriptImportStore(repository)({
      ...packet,
      attendees: [
        { displayName: "Eleanor Hughes", email: null },
        { displayName: "Marcus Patel", email: null },
      ],
      transcript: {
        ...packet.transcript,
        metadata: { provider: "manual_upload" },
      },
    });

    expect(storeImport).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [
        {
          profileId: "10000000-0000-4000-8000-000000000001",
          displayNameSnapshot: "Eleanor Hughes",
          sourceEmailSnapshot: null,
        },
        {
          profileId: "10000000-0000-4000-8000-000000000002",
          displayNameSnapshot: "Marcus Patel",
          sourceEmailSnapshot: null,
        },
      ],
    }));
    expect(linkManualAttendees).not.toHaveBeenCalled();
  });

  it("preserves manual-upload speakers when none have an application profile", async () => {
    const storeImport = vi.fn().mockResolvedValue({
      status: "stored",
      meetingId: "11111111-1111-4111-8111-111111111111",
      transcriptId: "22222222-2222-4222-8222-222222222222",
      importedAt: "2026-07-19T03:46:01.000Z",
    });
    const repository: TranscriptRepository = {
      listActiveMemberProfiles: vi.fn().mockResolvedValue([]),
      storeImport,
      linkManualAttendees: vi.fn(),
      resolveUnmatchedParticipants: vi.fn(),
    };

    await createTranscriptImportStore(repository)({
      ...packet,
      attendees: [
        { displayName: "Client Chair", email: null },
        { displayName: "Client Treasurer", email: null },
      ],
      transcript: {
        ...packet.transcript,
        metadata: { provider: "manual_upload" },
      },
    });

    expect(storeImport).toHaveBeenCalledWith(expect.objectContaining({
      attendees: [
        {
          profileId: null,
          displayNameSnapshot: "Client Chair",
          sourceEmailSnapshot: null,
        },
        {
          profileId: null,
          displayNameSnapshot: "Client Treasurer",
          sourceEmailSnapshot: null,
        },
      ],
    }));
  });
});
