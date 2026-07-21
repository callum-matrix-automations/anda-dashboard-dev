import { z } from "zod";
import {
  MeetingCategorySchema,
  MeetingStatusSchema,
  MeetingTagSchema,
} from "../schemas/entities";

export const MeetingReviewMinutesSchema = z.object({
  summary: z.string().trim().min(1).max(20_000),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(500),
    content: z.string().trim().min(1).max(100_000),
  }).strict()).min(1).max(250),
}).strict();

export const MeetingReviewOutcomeSchema = z.enum(["carried", "failed", "tabled", "not_seconded", "unresolved"]);
export const MeetingReviewVoteSelectionSchema = z.enum(["for", "against", "abstain", "unresolved"]);

export const MeetingReviewAttendeeOptionSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
}).strict();

export const MeetingReviewDraftSchema = z.object({
  minutes: MeetingReviewMinutesSchema,
  attendeeProfileIds: z.array(z.string().uuid()).min(1).max(250),
  motions: z.array(z.object({
    text: z.string().trim().min(1).max(20_000),
    moverProfileId: z.string().uuid().nullable(),
    seconderProfileId: z.string().uuid().nullable(),
    outcome: MeetingReviewOutcomeSchema,
    votes: z.array(z.object({
      profileId: z.string().uuid(),
      selection: MeetingReviewVoteSelectionSchema,
    }).strict()).max(250),
  }).strict()).max(250),
  tags: z.array(MeetingTagSchema).max(20),
}).strict().superRefine((draft, context) => {
  const attendeeIds = new Set<string>();
  draft.attendeeProfileIds.forEach((profileId, index) => {
    if (attendeeIds.has(profileId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attendeeProfileIds", index],
        message: "Attendees must be unique.",
      });
    }
    attendeeIds.add(profileId);
  });

  draft.motions.forEach((motion, motionIndex) => {
    for (const field of ["moverProfileId", "seconderProfileId"] as const) {
      const profileId = motion[field];
      if (profileId && !attendeeIds.has(profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["motions", motionIndex, field],
          message: "Mover and seconder must be meeting attendees.",
        });
      }
    }
    if (motion.moverProfileId && motion.moverProfileId === motion.seconderProfileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["motions", motionIndex, "seconderProfileId"],
        message: "A motion's mover and seconder must be different attendees.",
      });
    }
    if (motion.outcome === "not_seconded" && motion.seconderProfileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["motions", motionIndex, "seconderProfileId"],
        message: "A motion marked not seconded cannot name a seconder.",
      });
    }

    const voterIds = new Set<string>();
    motion.votes.forEach((vote, voteIndex) => {
      if (!attendeeIds.has(vote.profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["motions", motionIndex, "votes", voteIndex, "profileId"],
          message: "Votes must reference meeting attendees.",
        });
      }
      if (voterIds.has(vote.profileId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["motions", motionIndex, "votes", voteIndex, "profileId"],
          message: "An attendee may vote only once on a motion.",
        });
      }
      voterIds.add(vote.profileId);
    });
  });
});

export const MeetingReviewFailureSchema = z.object({
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  at: z.string().datetime({ offset: true }),
}).strict();

export const MeetingReviewApprovalSchema = z.object({
  approvedByProfileId: z.string().uuid(),
  approvedByDisplayName: z.string().trim().min(1),
  approvedAt: z.string().datetime({ offset: true }),
  contentVersion: z.number().int().positive(),
  unresolvedVotesAcknowledged: z.boolean(),
}).strict();

export const MeetingReviewPdfArtifactSchema = z.object({
  id: z.string().uuid(),
  path: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  documentVersion: z.number().int().positive(),
}).strict();

export const MeetingReviewSummarySchema = z.object({
  id: z.string().uuid(),
  sourceMeetingId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  category: MeetingCategorySchema,
  meetingDate: z.string().date(),
  durationMinutes: z.number().int().positive().max(1_440).nullable(),
  status: MeetingStatusSchema,
  version: z.number().int().positive(),
  deferredAt: z.string().datetime({ offset: true }).nullable(),
  deferredNote: z.string().nullable(),
  humanOwned: z.boolean(),
  failure: MeetingReviewFailureSchema.nullable(),
  approval: MeetingReviewApprovalSchema.nullable(),
  pdfArtifact: MeetingReviewPdfArtifactSchema.nullable(),
  pdfAttempt: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
}).strict();

export const MeetingReviewHistoryActionSchema = z.enum([
  "EDIT_SAVED",
  "MARKED_READY",
  "DEFERRED",
  "RESUMED",
  "APPROVED",
  "SIGNED",
  "TREASURER_REJECTED",
  "AI_RETRY",
  "PDF_RETRY",
  "ESIGN_RETRY",
]);

export const MeetingReviewDetailSchema = MeetingReviewSummarySchema.extend({
  tags: z.array(MeetingTagSchema),
  minutes: MeetingReviewMinutesSchema.nullable(),
  transcript: z.object({
    id: z.string().uuid(),
    sourceTranscriptId: z.string().trim().min(1),
    content: z.string(),
    metadata: z.record(z.unknown()),
    importedAt: z.string().datetime({ offset: true }),
  }).strict(),
  attendees: z.array(z.object({
    attendeeId: z.string().uuid(),
    profileId: z.string().uuid(),
    displayName: z.string().trim().min(1),
    sourceEmailSnapshot: z.string().email().nullable(),
  }).strict()),
  motions: z.array(z.object({
    motionId: z.string().uuid(),
    text: z.string(),
    moverProfileId: z.string().uuid().nullable(),
    seconderProfileId: z.string().uuid().nullable(),
    outcome: MeetingReviewOutcomeSchema,
    votes: z.array(z.object({
      voteId: z.string().uuid(),
      profileId: z.string().uuid(),
      selection: MeetingReviewVoteSelectionSchema,
    }).strict()),
  }).strict()),
  history: z.array(z.object({
    id: z.string().uuid(),
    actorProfileId: z.string().uuid(),
    actorDisplayName: z.string().trim().min(1),
    action: MeetingReviewHistoryActionSchema,
    note: z.string().nullable(),
    createdAt: z.string().datetime({ offset: true }),
  }).strict()),
}).strict();

const ReviewCommandIdentity = {
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
};

export const SaveMeetingReviewDraftCommandSchema = z.object({
  ...ReviewCommandIdentity,
  draft: MeetingReviewDraftSchema,
}).strict();

export const DeferMeetingReviewCommandSchema = z.object({
  ...ReviewCommandIdentity,
  note: z.string().trim().min(1).max(2_000),
}).strict();

export const ResumeMeetingReviewCommandSchema = z.object(ReviewCommandIdentity).strict();
export const MarkMeetingReadyCommandSchema = z.object(ReviewCommandIdentity).strict();

export const MEETING_REVIEW_MUTATION_STATUSES = [
  "saved",
  "deferred",
  "resumed",
  "ready",
  "not_found",
  "conflict",
  "protected",
  "invalid_state",
  "forbidden",
] as const;

export const MeetingReviewMutationResultSchema = z.object({
  status: z.enum(MEETING_REVIEW_MUTATION_STATUSES),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
}).strict();

export type MeetingReviewDraft = z.infer<typeof MeetingReviewDraftSchema>;
export type MeetingReviewAttendeeOption = z.infer<typeof MeetingReviewAttendeeOptionSchema>;
export type MeetingReviewSummary = z.infer<typeof MeetingReviewSummarySchema>;
export type MeetingReviewDetail = z.infer<typeof MeetingReviewDetailSchema>;
export type SaveMeetingReviewDraftCommand = z.infer<typeof SaveMeetingReviewDraftCommandSchema>;
export type DeferMeetingReviewCommand = z.infer<typeof DeferMeetingReviewCommandSchema>;
export type ResumeMeetingReviewCommand = z.infer<typeof ResumeMeetingReviewCommandSchema>;
export type MarkMeetingReadyCommand = z.infer<typeof MarkMeetingReadyCommandSchema>;
export type MeetingReviewMutationResult = z.infer<typeof MeetingReviewMutationResultSchema>;
