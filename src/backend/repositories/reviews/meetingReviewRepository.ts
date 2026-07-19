import type {
  DeferMeetingReviewCommand,
  MarkMeetingReadyCommand,
  MeetingReviewDetail,
  MeetingReviewMutationResult,
  MeetingReviewSummary,
  ResumeMeetingReviewCommand,
  SaveMeetingReviewDraftCommand,
} from "../../../shared/contracts/meetingReview";

export interface MeetingReviewRepository {
  listReviews(): Promise<MeetingReviewSummary[]>;
  getReview(meetingId: string): Promise<MeetingReviewDetail | null>;
  saveDraft(command: SaveMeetingReviewDraftCommand): Promise<MeetingReviewMutationResult>;
  deferReview(command: DeferMeetingReviewCommand): Promise<MeetingReviewMutationResult>;
  resumeReview(command: ResumeMeetingReviewCommand): Promise<MeetingReviewMutationResult>;
  markReady(command: MarkMeetingReadyCommand): Promise<MeetingReviewMutationResult>;
}
