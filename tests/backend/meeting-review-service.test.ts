import { describe, expect, it, vi } from "vitest";
import type { MeetingReviewRepository } from "../../src/backend/repositories/reviews/meetingReviewRepository";
import { createMeetingReviewService } from "../../src/backend/services/reviews/meetingReviewService";

const meetingId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "10000000-0000-4000-8000-000000000001";

describe("meeting review service", () => {
  it("delegates validated review operations to the repository", async () => {
    const repository = repositoryMock();
    const service = createMeetingReviewService(repository);
    const reviewIdentity = {
      meetingId,
      expectedVersion: 4,
      actorProfileId,
    };
    const command = {
      ...reviewIdentity,
      draft: {
        minutes: {
          summary: "Updated summary.",
          sections: [{ heading: "Update", content: "Updated content." }],
        },
        attendeeProfileIds: [actorProfileId],
        motions: [],
        tags: [],
      },
    };

    await service.saveMeetingDraft(command);
    await service.listMeetingAttendeeOptions();
    await service.deferMeetingReview({ ...reviewIdentity, note: "Awaiting information." });
    await service.resumeMeetingReview(reviewIdentity);
    await service.markMeetingReady(reviewIdentity);

    expect(repository.saveDraft).toHaveBeenCalledWith(command);
    expect(repository.listAttendeeOptions).toHaveBeenCalledOnce();
    expect(repository.deferReview).toHaveBeenCalledWith({
      meetingId,
      expectedVersion: 4,
      actorProfileId,
      note: "Awaiting information.",
    });
    expect(repository.resumeReview).toHaveBeenCalledWith({ meetingId, expectedVersion: 4, actorProfileId });
    expect(repository.markReady).toHaveBeenCalledWith({ meetingId, expectedVersion: 4, actorProfileId });
  });

  it("rejects invalid identifiers and commands before repository access", async () => {
    const repository = repositoryMock();
    const service = createMeetingReviewService(repository);

    expect(() => service.getMeetingReview("not-a-uuid")).toThrow();
    expect(() => service.deferMeetingReview({
      meetingId,
      expectedVersion: 1,
      actorProfileId,
      note: " ",
    })).toThrow();
    expect(repository.getReview).not.toHaveBeenCalled();
    expect(repository.deferReview).not.toHaveBeenCalled();
  });
});

function repositoryMock(): MeetingReviewRepository {
  return {
    listReviews: vi.fn().mockResolvedValue([]),
    getReview: vi.fn().mockResolvedValue(null),
    listAttendeeOptions: vi.fn().mockResolvedValue([]),
    saveDraft: vi.fn().mockResolvedValue({ status: "saved", meetingId, version: 5 }),
    deferReview: vi.fn().mockResolvedValue({ status: "deferred", meetingId, version: 5 }),
    resumeReview: vi.fn().mockResolvedValue({ status: "resumed", meetingId, version: 5 }),
    markReady: vi.fn().mockResolvedValue({ status: "ready", meetingId, version: 5 }),
  };
}
