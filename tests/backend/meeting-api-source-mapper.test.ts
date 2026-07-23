import { describe, expect, it } from "vitest";
import { mapMeetingApiSource } from "../../src/backend/integrations/meetings/meetingApiSourceMapper";
import type { MeetingReviewDetail } from "../../src/shared/contracts/meetingReview";

const matchedProfileId = "11111111-1111-4111-8111-111111111111";

describe("meeting API source mapper", () => {
  it("returns curated provider-neutral provenance and email-based participant matches", () => {
    const result = mapMeetingApiSource(detail());

    expect(result.source).toEqual({
      sourceMeetingId: "read_ai:session-1",
      startedAt: "2026-07-20T08:00:00.000Z",
      endedAt: "2026-07-20T09:00:00.000Z",
      durationMinutes: 60,
      importedAt: "2026-07-20T09:01:00.000Z",
    });
    expect(result.sourceParticipants).toEqual([
      {
        displayName: "Eleanor Hughes",
        email: "eleanor@example.test",
        profileId: matchedProfileId,
        matchStatus: "matched",
      },
      {
        displayName: "Guest Person",
        email: "guest@example.test",
        profileId: null,
        matchStatus: "unmatched",
      },
      {
        displayName: "Invalid Email",
        email: null,
        profileId: null,
        matchStatus: "unmatched",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("provider");
    expect(JSON.stringify(result)).not.toContain("private provider summary");
  });

  it("falls back to linked attendees when legacy metadata has no participants", () => {
    const legacy = detail();
    legacy.transcript.metadata = {};

    expect(mapMeetingApiSource(legacy).sourceParticipants).toEqual([{
      displayName: "Eleanor Hughes",
      email: "eleanor@example.test",
      profileId: matchedProfileId,
      matchStatus: "matched",
    }]);
  });
});

function detail(): MeetingReviewDetail {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    sourceMeetingId: "read_ai:session-1",
    title: "Board meeting",
    category: "Board Meeting",
    meetingDate: "2026-07-20",
    durationMinutes: 60,
    status: "PENDING_APPROVAL",
    version: 3,
    deferredAt: null,
    deferredNote: null,
    humanOwned: false,
    failure: null,
    approval: null,
    pdfArtifact: null,
    pdfAttempt: 0,
    updatedAt: "2026-07-20T09:02:00.000Z",
    tags: [],
    minutes: null,
    transcript: {
      id: "33333333-3333-4333-8333-333333333333",
      sourceTranscriptId: "read_ai:session-1",
      content: "Transcript evidence.",
      metadata: {
        provider: "read_ai",
        summary: "private provider summary",
        startTime: "2026-07-20T08:00:00.000Z",
        endTime: "2026-07-20T09:00:00.000Z",
        participants: [
          { name: " Eleanor   Hughes ", email: "ELEANOR@example.test" },
          { name: "Duplicate", email: "eleanor@example.test" },
          { name: "Guest Person", email: "guest@example.test" },
          { name: "Invalid Email", email: "not-an-email" },
        ],
      },
      importedAt: "2026-07-20T09:01:00.000Z",
    },
    attendees: [{
      attendeeId: "44444444-4444-4444-8444-444444444444",
      profileId: matchedProfileId,
      displayName: "Eleanor Hughes",
      sourceEmailSnapshot: "eleanor@example.test",
    }],
    motions: [],
    history: [],
  };
}
