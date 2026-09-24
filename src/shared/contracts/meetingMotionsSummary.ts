import { z } from "zod";
import { MeetingReviewOutcomeSchema } from "./meetingReview";

export const MeetingMotionsSummarySchema = z.object({
  meetingId: z.string().uuid(),
  meetingVersion: z.number().int().positive(),
  items: z.array(z.object({
    motionId: z.string().uuid(),
    text: z.string().trim().min(1),
    outcome: MeetingReviewOutcomeSchema,
    putToVote: z.boolean(),
  }).strict()),
}).strict();

export type MeetingMotionsSummary = z.infer<typeof MeetingMotionsSummarySchema>;
