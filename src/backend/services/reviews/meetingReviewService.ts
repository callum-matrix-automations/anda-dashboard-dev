import { z } from "zod";
import type { MeetingReviewRepository } from "../../repositories/reviews/meetingReviewRepository";
import { supabaseMeetingReviewRepository } from "../../repositories/supabase/supabaseMeetingReviewRepository";
import {
  DeferMeetingReviewCommandSchema,
  MarkMeetingReadyCommandSchema,
  ResumeMeetingReviewCommandSchema,
  SaveMeetingReviewDraftCommandSchema,
  type DeferMeetingReviewCommand,
  type MarkMeetingReadyCommand,
  type ResumeMeetingReviewCommand,
  type SaveMeetingReviewDraftCommand,
} from "../../../shared/contracts/meetingReview";

const MeetingIdSchema = z.string().uuid();

export function createMeetingReviewService(repository: MeetingReviewRepository) {
  return {
    listMeetingReviews() {
      return repository.listReviews();
    },

    getMeetingReview(meetingId: string) {
      return repository.getReview(MeetingIdSchema.parse(meetingId));
    },

    saveMeetingDraft(command: SaveMeetingReviewDraftCommand) {
      return repository.saveDraft(SaveMeetingReviewDraftCommandSchema.parse(command));
    },

    deferMeetingReview(command: DeferMeetingReviewCommand) {
      return repository.deferReview(DeferMeetingReviewCommandSchema.parse(command));
    },

    resumeMeetingReview(command: ResumeMeetingReviewCommand) {
      return repository.resumeReview(ResumeMeetingReviewCommandSchema.parse(command));
    },

    markMeetingReady(command: MarkMeetingReadyCommand) {
      return repository.markReady(MarkMeetingReadyCommandSchema.parse(command));
    },
  };
}

export const meetingReviewService = createMeetingReviewService(supabaseMeetingReviewRepository);

export const listMeetingReviews = meetingReviewService.listMeetingReviews;
export const getMeetingReview = meetingReviewService.getMeetingReview;
export const saveMeetingDraft = meetingReviewService.saveMeetingDraft;
export const deferMeetingReview = meetingReviewService.deferMeetingReview;
export const resumeMeetingReview = meetingReviewService.resumeMeetingReview;
export const markMeetingReady = meetingReviewService.markMeetingReady;
