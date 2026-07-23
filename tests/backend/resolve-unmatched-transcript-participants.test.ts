import { describe, expect, it, vi } from "vitest";
import { createUnmatchedTranscriptParticipantResolver } from "../../src/backend/services/transcripts/resolveUnmatchedTranscriptParticipants";
import type { TranscriptRepository } from "../../src/backend/repositories/transcripts/transcriptRepository";

describe("resolveUnmatchedTranscriptParticipants", () => {
  it("returns the meeting identity and number of newly resolved participants", async () => {
    const resolveUnmatchedParticipants = vi.fn().mockResolvedValue(2);
    const repository: TranscriptRepository = {
      listActiveMemberProfiles: vi.fn(),
      storeImport: vi.fn(),
      linkManualAttendees: vi.fn(),
      resolveUnmatchedParticipants,
    };
    const meetingId = "11111111-1111-4111-8111-111111111111";

    await expect(createUnmatchedTranscriptParticipantResolver(repository)(meetingId)).resolves.toEqual({
      meetingId,
      resolvedCount: 2,
    });
    expect(resolveUnmatchedParticipants).toHaveBeenCalledWith(meetingId);
  });
});
