import { z } from "zod";
import {
  MeetingReviewMinutesSchema,
  MeetingReviewOutcomeSchema,
  MeetingReviewVoteSelectionSchema,
} from "./meetingReview";

const MeetingIdentitySchema = z.object({
  id: z.string().uuid(),
  sourceMeetingId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  meetingDate: z.string().date(),
  durationMinutes: z.number().int().positive().max(1_440).nullable(),
  contentVersion: z.number().int().positive(),
}).strict();

const ApprovedAttendeeSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
}).strict();

const ApprovedVoteSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
  selection: MeetingReviewVoteSelectionSchema,
}).strict();

const ApprovedMotionSchema = z.object({
  text: z.string().trim().min(1),
  moverProfileId: z.string().uuid(),
  moverDisplayName: z.string().trim().min(1),
  seconderProfileId: z.string().uuid(),
  seconderDisplayName: z.string().trim().min(1),
  outcome: MeetingReviewOutcomeSchema.exclude(["unresolved"]),
  votes: z.array(ApprovedVoteSchema),
}).strict();

const ApprovalIdentitySchema = z.object({
  approvedByProfileId: z.string().uuid(),
  approvedByDisplayName: z.string().trim().min(1),
  approvedAt: z.string().datetime({ offset: true }),
  unresolvedVotesAcknowledged: z.boolean(),
  unresolvedVoteCount: z.number().int().nonnegative(),
}).strict();

export const ApprovedMeetingSnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  meeting: MeetingIdentitySchema,
  minutes: MeetingReviewMinutesSchema,
  attendees: z.array(ApprovedAttendeeSchema).min(1),
  motions: z.array(ApprovedMotionSchema),
  approval: ApprovalIdentitySchema,
}).strict();

export const MinutesPdfArtifactSchema = z.object({
  id: z.string().uuid(),
  path: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  documentVersion: z.number().int().positive(),
}).strict();

const ApprovalCommandIdentity = {
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
};

export const ApproveMeetingCommandSchema = z.object({
  ...ApprovalCommandIdentity,
  acknowledgeUnresolvedVotes: z.boolean(),
}).strict();

export const RetryMeetingPdfCommandSchema = z.object(ApprovalCommandIdentity).strict();

export const MEETING_APPROVAL_STATUSES = [
  "approved",
  "not_found",
  "conflict",
  "invalid_actor",
  "deferred",
  "invalid_state",
  "invalid_content",
  "acknowledgement_required",
] as const;

export const MeetingApprovalResultSchema = z.object({
  status: z.enum(MEETING_APPROVAL_STATUSES),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  unresolvedVoteCount: z.number().int().nonnegative(),
  documentVersion: z.number().int().positive().nullable(),
}).strict();

export const MEETING_PDF_RETRY_STATUSES = [
  "retry_started",
  "not_found",
  "conflict",
  "invalid_actor",
  "invalid_state",
] as const;

export const MeetingPdfRetryResultSchema = z.object({
  status: z.enum(MEETING_PDF_RETRY_STATUSES),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  documentVersion: z.number().int().positive().nullable(),
}).strict();

export const MeetingPdfClaimSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    meetingId: z.string().uuid(),
    runId: z.string().uuid(),
    attempt: z.number().int().positive(),
    documentVersion: z.number().int().positive(),
    snapshot: ApprovedMeetingSnapshotSchema,
  }).strict(),
  z.object({
    status: z.enum(["not_found", "already_processing", "already_completed", "retry_required", "protected"]),
    meetingId: z.string().uuid(),
    attempt: z.number().int().nonnegative().nullable(),
  }).strict(),
]);

export const MeetingPdfPersistenceStatusSchema = z.enum(["saved", "not_found", "stale"]);
export const MeetingPdfFailureStatusSchema = z.enum(["failed", "not_found", "stale"]);

export const MeetingPdfFailureSchema = z.object({
  code: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2_000),
}).strict();

export type ApprovedMeetingSnapshot = z.infer<typeof ApprovedMeetingSnapshotSchema>;
export type MinutesPdfArtifact = z.infer<typeof MinutesPdfArtifactSchema>;
export type ApproveMeetingCommand = z.infer<typeof ApproveMeetingCommandSchema>;
export type RetryMeetingPdfCommand = z.infer<typeof RetryMeetingPdfCommandSchema>;
export type MeetingApprovalResult = z.infer<typeof MeetingApprovalResultSchema>;
export type MeetingPdfRetryResult = z.infer<typeof MeetingPdfRetryResultSchema>;
export type MeetingPdfClaim = z.infer<typeof MeetingPdfClaimSchema>;
export type MeetingPdfPersistenceStatus = z.infer<typeof MeetingPdfPersistenceStatusSchema>;
export type MeetingPdfFailureStatus = z.infer<typeof MeetingPdfFailureStatusSchema>;
export type MeetingPdfFailure = z.infer<typeof MeetingPdfFailureSchema>;
