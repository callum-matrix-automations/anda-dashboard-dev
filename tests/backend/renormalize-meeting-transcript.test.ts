import { describe, expect, it, vi } from "vitest";
import { createMeetingTranscriptRenormalizer } from "../../src/backend/services/transcripts/renormalizeMeetingTranscript";
import type { TranscriptNormalizationResult } from "../../src/shared/contracts/transcriptNormalization";

const meetingId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "22222222-2222-4222-8222-222222222222";

describe("meeting transcript renormalization", () => {
  it("stores a new normalization, keeps generic speakers unlinked, and reruns analysis", async () => {
    const replaceManualNormalization = vi.fn().mockResolvedValue({ status: "saved", version: 5 });
    const analyze = vi.fn().mockResolvedValue({ status: "completed", meetingId, attempt: 1 });
    const service = createMeetingTranscriptRenormalizer({
      reviews: { getReview: vi.fn().mockResolvedValue(review("manual:source-1")) },
      transcripts: {
        listActiveMemberProfiles: vi.fn().mockResolvedValue([{
          profileId: "33333333-3333-4333-8333-333333333333",
          displayName: "Ernesto Tinoco",
          email: "ernesto@example.test",
        }]),
        replaceManualNormalization,
      },
      normalize: vi.fn().mockResolvedValue(normalization()),
      analyze,
    });

    await expect(service({ meetingId, expectedVersion: 4, actorProfileId })).resolves.toEqual({
      status: "completed",
      meetingId,
      version: null,
      attempt: 1,
    });
    expect(replaceManualNormalization).toHaveBeenCalledWith(expect.objectContaining({
      meetingId,
      expectedVersion: 4,
      actorProfileId,
      attendees: [
        expect.objectContaining({ displayNameSnapshot: "Ernesto Tinoco", profileId: "33333333-3333-4333-8333-333333333333" }),
        expect.objectContaining({ displayNameSnapshot: "Unidentified Speaker", profileId: null }),
      ],
      normalization: expect.objectContaining({ normalizedContent: expect.stringContaining("Ernesto Tinoco:") }),
    }));
    expect(analyze).toHaveBeenCalledWith(meetingId);
  });

  it("protects non-manual sources and does not normalize them", async () => {
    const normalize = vi.fn();
    const service = createMeetingTranscriptRenormalizer({
      reviews: { getReview: vi.fn().mockResolvedValue(review("read_ai:source-1")) },
      transcripts: {
        listActiveMemberProfiles: vi.fn(),
        replaceManualNormalization: vi.fn(),
      },
      normalize,
      analyze: vi.fn(),
    });

    await expect(service({ meetingId, expectedVersion: 4, actorProfileId })).resolves.toMatchObject({
      status: "protected",
      version: 4,
    });
    expect(normalize).not.toHaveBeenCalled();
  });

  it("does not rerun analysis when optimistic locking rejects the replacement", async () => {
    const analyze = vi.fn();
    const service = createMeetingTranscriptRenormalizer({
      reviews: { getReview: vi.fn().mockResolvedValue(review("manual:source-1")) },
      transcripts: {
        listActiveMemberProfiles: vi.fn().mockResolvedValue([]),
        replaceManualNormalization: vi.fn().mockResolvedValue({ status: "conflict", version: 7 }),
      },
      normalize: vi.fn().mockResolvedValue(normalization()),
      analyze,
    });

    await expect(service({ meetingId, expectedVersion: 4, actorProfileId })).resolves.toMatchObject({
      status: "conflict",
      version: 7,
    });
    expect(analyze).not.toHaveBeenCalled();
  });
});

function review(sourceMeetingId: string) {
  return {
    version: 4,
    sourceMeetingId,
    transcript: {
      content: "0:00 - Ernesto Tinoco\nWelcome.\n0:04 - Unidentified Speaker\nSecond.",
      metadata: { provider: sourceMeetingId.startsWith("manual:") ? "manual_upload" : "read_ai" },
    },
  } as never;
}

function normalization(): TranscriptNormalizationResult {
  const canonicalTranscript = "Ernesto Tinoco: Welcome.\nUnidentified Speaker: Second.";
  return {
    method: "deterministic",
    detectedFormat: "timestamp_speaker_blocks",
    canonicalTranscript,
    originalContentHash: "a".repeat(64),
    normalizedContentHash: "b".repeat(64),
    model: null,
    responseId: null,
    requestId: null,
    participants: [
      { displayName: "Ernesto Tinoco", kind: "named" },
      { displayName: "Unidentified Speaker", kind: "generic" },
    ],
    possibleAliases: [],
    warnings: [{
      code: "generic_speakers",
      severity: "warning",
      message: "One generic speaker was retained.",
    }],
    turnCount: 2,
    attributionCoverage: 1,
  };
}
