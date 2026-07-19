import { describe, expect, it } from "vitest";
import {
  DeferMeetingReviewCommandSchema,
  MeetingReviewDraftSchema,
} from "../../src/shared/contracts/meetingReview";

const eleanorId = "10000000-0000-4000-8000-000000000001";
const marcusId = "10000000-0000-4000-8000-000000000002";

describe("meeting review contract", () => {
  it("accepts a complete editable draft with unresolved decisions", () => {
    expect(MeetingReviewDraftSchema.safeParse(validDraft()).success).toBe(true);
  });

  it("rejects duplicate attendees, non-attendee roles, and duplicate votes", () => {
    const result = MeetingReviewDraftSchema.safeParse({
      ...validDraft(),
      attendeeProfileIds: [eleanorId, eleanorId],
      motions: [{
        ...validDraft().motions[0],
        seconderProfileId: marcusId,
        votes: [
          { profileId: eleanorId, selection: "for" },
          { profileId: eleanorId, selection: "against" },
        ],
      }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(expect.arrayContaining([
        "attendeeProfileIds.1",
        "motions.0.seconderProfileId",
        "motions.0.votes.1.profileId",
      ]));
    }
  });

  it("requires a non-blank deferral explanation", () => {
    expect(DeferMeetingReviewCommandSchema.safeParse({
      meetingId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 3,
      actorProfileId: eleanorId,
      note: "   ",
    }).success).toBe(false);
  });
});

function validDraft() {
  return {
    minutes: {
      summary: "The board reviewed the agenda.",
      sections: [{ heading: "Decisions", content: "The proposal remains unresolved." }],
    },
    attendeeProfileIds: [eleanorId],
    motions: [{
      text: "Consider the proposal.",
      moverProfileId: eleanorId,
      seconderProfileId: null,
      outcome: "unresolved" as const,
      votes: [{ profileId: eleanorId, selection: "unresolved" as const }],
    }],
    tags: ["governance"],
  };
}
