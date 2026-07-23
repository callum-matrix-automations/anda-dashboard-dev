import { z } from "zod";

export const SigningRecipientSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
}).strict();

export const RetryMeetingSigningCommandSchema = z.object({
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
}).strict();

export const MEETING_SIGNING_RETRY_STATUSES = [
  "retry_started",
  "not_found",
  "conflict",
  "invalid_actor",
  "invalid_state",
] as const;

export const MeetingSigningRetryResultSchema = z.object({
  status: z.enum(MEETING_SIGNING_RETRY_STATUSES),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  pdfId: z.string().uuid().nullable(),
  documentVersion: z.number().int().positive().nullable(),
}).strict();

export const MeetingSigningClaimSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    meetingId: z.string().uuid(),
    runId: z.string().uuid(),
    attempt: z.number().int().positive(),
    pdfId: z.string().uuid(),
    pdfPath: z.string().trim().min(1),
    pdfSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    pdfSizeBytes: z.number().int().positive(),
    documentVersion: z.number().int().positive(),
    requestName: z.string().trim().min(1).max(255),
    externalRequestId: z.string().trim().min(1).nullable(),
  }).strict(),
  z.object({
    status: z.enum([
      "not_found",
      "already_processing",
      "already_completed",
      "retry_required",
      "protected",
    ]),
    meetingId: z.string().uuid(),
    attempt: z.number().int().nonnegative().nullable(),
  }).strict(),
]);

export const MeetingSigningCreationStatusSchema = z.enum([
  "saved",
  "not_found",
  "stale",
  "conflict",
]);
export const MeetingSigningPersistenceStatusSchema = z.enum(["saved", "not_found", "stale"]);
export const MeetingSigningFailureStatusSchema = z.enum(["failed", "not_found", "stale"]);

export const MeetingSigningFailureSchema = z.object({
  code: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2_000),
}).strict();

export const SIGNING_OUTCOME_STATUSES = [
  "AWAITING",
  "PROCESSING",
  "READY_FOR_ARCHIVE",
  "REJECTING",
  "REJECTED",
  "COMPLETION_FAILED",
  "REJECTION_FAILED",
] as const;

export const FirmaRecipientSchema = z.object({
  id: z.string().trim().min(1),
  email: z.string().trim().email(),
  finishedAt: z.string().datetime({ offset: true }).nullable(),
  declinedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const FirmaRequestDetailsSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string().trim().min(1),
  recipients: z.array(FirmaRecipientSchema),
  completedAt: z.string().datetime({ offset: true }).nullable(),
}).strict();

export const SignedDocumentSchema = z.object({
  bytes: z.instanceof(Uint8Array),
  generatedAt: z.string().datetime({ offset: true }).nullable(),
  isPartial: z.boolean(),
}).strict();

export const MeetingSigningOutcomeClaimSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    eventId: z.string().trim().min(1).nullable(),
    eventRecordId: z.string().uuid().nullable(),
    meetingId: z.string().uuid(),
    requestId: z.string().uuid(),
    externalRequestId: z.string().trim().min(1),
    documentVersion: z.number().int().positive(),
    runId: z.string().uuid(),
    attempt: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "already_processing", "already_completed", "protected", "stale"]),
    eventId: z.string().nullable().optional(),
    meetingId: z.string().uuid().optional(),
    attempt: z.number().int().nonnegative().nullable(),
  }).strict(),
]);

export const FirmaWebhookEventSchema = z.object({
  id: z.string().trim().min(1).max(500),
  type: z.string().trim().min(1).max(500),
  data: z.unknown().optional(),
  signing_request_id: z.string().trim().min(1).optional(),
}).passthrough();

export const FirmaWebhookReceiptSchema = z.object({
  status: z.enum(["accepted", "retry", "duplicate", "ignored", "conflict"]),
  eventRecordId: z.string().uuid(),
  meetingId: z.string().uuid().nullable(),
}).strict();

export const MeetingSigningSessionRecordSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    meetingId: z.string().uuid(),
    requestId: z.string().uuid(),
    externalRequestId: z.string().trim().min(1),
    documentVersion: z.number().int().positive(),
    outcomeStatus: z.enum(SIGNING_OUTCOME_STATUSES),
    recipientEmail: z.string().email().nullable(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "invalid_state"]),
    meetingId: z.string().uuid(),
  }).strict(),
]);

export const MeetingSigningSessionSchema = z.object({
  status: z.literal("available"),
  meetingId: z.string().uuid(),
  requestId: z.string().uuid(),
  externalRequestId: z.string().trim().min(1),
  documentVersion: z.number().int().positive(),
  outcomeStatus: z.enum(SIGNING_OUTCOME_STATUSES),
  providerStatus: z.string().trim().min(1),
  recipientId: z.string().trim().min(1),
  recipientEmail: z.string().email(),
  signingUrl: z.string().url(),
}).strict();

export const RejectMeetingSigningCommandSchema = z.object({
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
  comment: z.string().trim().min(1).max(2_000),
}).strict();

export const MeetingSigningRejectionClaimSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    meetingId: z.string().uuid(),
    requestId: z.string().uuid(),
    externalRequestId: z.string().trim().min(1),
    runId: z.string().uuid(),
    version: z.number().int().positive(),
    documentVersion: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "invalid_actor", "comment_required", "conflict", "invalid_state"]),
    meetingId: z.string().uuid(),
    version: z.number().int().positive().nullable(),
  }).strict(),
]);

export const MeetingSigningRejectionResultSchema = z.object({
  status: z.enum(["rejected", "not_found", "stale"]),
  meetingId: z.string().uuid().nullable(),
  version: z.number().int().positive().nullable(),
  documentVersion: z.number().int().positive().optional(),
}).strict();

export const RetryMeetingSigningOutcomeResultSchema = z.object({
  status: z.enum(["retry_started", "not_found", "conflict", "invalid_actor", "invalid_state"]),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  documentVersion: z.number().int().positive().optional(),
}).strict();

export type SigningRecipient = z.infer<typeof SigningRecipientSchema>;
export type RetryMeetingSigningCommand = z.infer<typeof RetryMeetingSigningCommandSchema>;
export type MeetingSigningRetryResult = z.infer<typeof MeetingSigningRetryResultSchema>;
export type MeetingSigningClaim = z.infer<typeof MeetingSigningClaimSchema>;
export type MeetingSigningCreationStatus = z.infer<typeof MeetingSigningCreationStatusSchema>;
export type MeetingSigningPersistenceStatus = z.infer<typeof MeetingSigningPersistenceStatusSchema>;
export type MeetingSigningFailureStatus = z.infer<typeof MeetingSigningFailureStatusSchema>;
export type MeetingSigningFailure = z.infer<typeof MeetingSigningFailureSchema>;
export type FirmaRecipient = z.infer<typeof FirmaRecipientSchema>;
export type FirmaRequestDetails = z.infer<typeof FirmaRequestDetailsSchema>;
export type SignedDocument = z.infer<typeof SignedDocumentSchema>;
export type MeetingSigningOutcomeClaim = z.infer<typeof MeetingSigningOutcomeClaimSchema>;
export type FirmaWebhookEvent = z.infer<typeof FirmaWebhookEventSchema>;
export type FirmaWebhookReceipt = z.infer<typeof FirmaWebhookReceiptSchema>;
export type MeetingSigningSessionRecord = z.infer<typeof MeetingSigningSessionRecordSchema>;
export type MeetingSigningSession = z.infer<typeof MeetingSigningSessionSchema>;
export type RejectMeetingSigningCommand = z.infer<typeof RejectMeetingSigningCommandSchema>;
export type MeetingSigningRejectionClaim = z.infer<typeof MeetingSigningRejectionClaimSchema>;
export type MeetingSigningRejectionResult = z.infer<typeof MeetingSigningRejectionResultSchema>;
export type RetryMeetingSigningOutcomeResult = z.infer<typeof RetryMeetingSigningOutcomeResultSchema>;
