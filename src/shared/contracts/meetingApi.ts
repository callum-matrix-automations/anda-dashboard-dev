import { z } from "zod";
import { MeetingCategorySchema, MeetingStatusSchema } from "../schemas/entities";
import {
  MeetingReviewApprovalSchema,
  MeetingReviewDraftSchema,
  MeetingReviewFailureSchema,
  MeetingReviewHistoryActionSchema,
  MeetingReviewMinutesSchema,
  MeetingReviewOutcomeSchema,
  MeetingReviewVoteSelectionSchema,
} from "./meetingReview";

export const MeetingApiQueueSchema = z.enum([
  "all",
  "needs-review",
  "deferred",
  "signing",
  "archive",
]);

export const MeetingApiListQuerySchema = z.object({
  queue: MeetingApiQueueSchema.default("all"),
  status: MeetingStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().nonnegative().default(0),
}).strict();

export const MeetingApiSearchQuerySchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().nonnegative().default(0),
}).strict();

export const MeetingApiCapabilitiesSchema = z.object({
  canEdit: z.boolean(),
  canDefer: z.boolean(),
  canResume: z.boolean(),
  canMarkReady: z.boolean(),
  canRetryAnalysis: z.boolean(),
  canApprove: z.boolean(),
  canRetryPdf: z.boolean(),
  canOpenSigningSession: z.boolean(),
  canRetrySigning: z.boolean(),
  canRejectSigning: z.boolean(),
  canRetrySigningOutcome: z.boolean(),
  canDownloadArchive: z.boolean(),
}).strict();

export const MeetingApiPdfArtifactSchema = z.object({
  id: z.string().uuid(),
  sizeBytes: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  generatedAt: z.string().datetime({ offset: true }),
  documentVersion: z.number().int().positive(),
}).strict();

export const MeetingApiSummarySchema = z.object({
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
  pdfArtifact: MeetingApiPdfArtifactSchema.nullable(),
  pdfAttempt: z.number().int().nonnegative(),
  updatedAt: z.string().datetime({ offset: true }),
  capabilities: MeetingApiCapabilitiesSchema,
}).strict();

export const MeetingApiListResponseSchema = z.object({
  items: z.array(MeetingApiSummarySchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
}).strict();

export const MeetingApiSourceSchema = z.object({
  sourceMeetingId: z.string().trim().min(1),
  startedAt: z.string().datetime({ offset: true }).nullable(),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  durationMinutes: z.number().int().positive().max(1_440).nullable(),
  importedAt: z.string().datetime({ offset: true }),
}).strict();

export const MeetingApiSourceParticipantSchema = z.object({
  displayName: z.string().trim().min(1),
  email: z.string().email().nullable(),
  profileId: z.string().uuid().nullable(),
  matchStatus: z.enum(["matched", "unmatched"]),
}).strict().superRefine((participant, context) => {
  if (participant.matchStatus === "matched" && !participant.profileId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profileId"],
      message: "Matched source participants require a linked profile.",
    });
  }
  if (participant.matchStatus === "unmatched" && participant.profileId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["profileId"],
      message: "Unmatched source participants cannot contain a linked profile.",
    });
  }
});

export const MeetingApiDetailSchema = MeetingApiSummarySchema.extend({
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  minutes: MeetingReviewMinutesSchema.nullable(),
  transcript: z.object({
    id: z.string().uuid(),
    sourceTranscriptId: z.string().trim().min(1),
    content: z.string(),
    importedAt: z.string().datetime({ offset: true }),
  }).strict(),
  source: MeetingApiSourceSchema,
  sourceParticipants: z.array(MeetingApiSourceParticipantSchema),
  attendees: z.array(z.object({
    attendeeId: z.string().uuid(),
    profileId: z.string().uuid(),
    displayName: z.string().trim().min(1),
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

export const MeetingApiSaveDraftRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  draft: MeetingReviewDraftSchema,
}).strict();

export const MeetingApiDeferRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  note: z.string().trim().min(1).max(2_000),
}).strict();

export const MeetingApiVersionedRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const MeetingApiApproveRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  acknowledgeUnresolvedVotes: z.boolean(),
}).strict();

export const MeetingApiRejectSigningRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().trim().min(1).max(2_000),
}).strict();

export const MeetingApiMutationResponseSchema = z.object({
  action: z.enum([
    "draft_saved",
    "deferred",
    "resumed",
    "marked_ready",
    "analysis_retry_completed",
    "approved",
    "pdf_retry_started",
    "signing_retry_started",
    "signing_rejected",
    "signing_outcome_retry_started",
  ]),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  documentVersion: z.number().int().positive().nullable().optional(),
  unresolvedVoteCount: z.number().int().nonnegative().optional(),
  attempt: z.number().int().positive().optional(),
}).strict();

export const MeetingApiSigningSessionSchema = z.object({
  meetingId: z.string().uuid(),
  documentVersion: z.number().int().positive(),
  providerStatus: z.string().trim().min(1),
  recipientEmail: z.string().email(),
  signingUrl: z.string().url(),
}).strict();

export const MeetingApiErrorIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
}).strict();

export const MeetingApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    issues: z.array(MeetingApiErrorIssueSchema).optional(),
    currentVersion: z.number().int().positive().nullable().optional(),
    unresolvedVoteCount: z.number().int().nonnegative().optional(),
  }).strict(),
}).strict();

export type MeetingApiQueue = z.infer<typeof MeetingApiQueueSchema>;
export type MeetingApiListQuery = z.infer<typeof MeetingApiListQuerySchema>;
export type MeetingApiSearchQuery = z.infer<typeof MeetingApiSearchQuerySchema>;
export type MeetingApiCapabilities = z.infer<typeof MeetingApiCapabilitiesSchema>;
export type MeetingApiSummary = z.infer<typeof MeetingApiSummarySchema>;
export type MeetingApiListResponse = z.infer<typeof MeetingApiListResponseSchema>;
export type MeetingApiDetail = z.infer<typeof MeetingApiDetailSchema>;
export type MeetingApiMutationResponse = z.infer<typeof MeetingApiMutationResponseSchema>;
export type MeetingApiSigningSession = z.infer<typeof MeetingApiSigningSessionSchema>;
