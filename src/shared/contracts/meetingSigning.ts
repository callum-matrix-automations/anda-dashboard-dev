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

export type SigningRecipient = z.infer<typeof SigningRecipientSchema>;
export type RetryMeetingSigningCommand = z.infer<typeof RetryMeetingSigningCommandSchema>;
export type MeetingSigningRetryResult = z.infer<typeof MeetingSigningRetryResultSchema>;
export type MeetingSigningClaim = z.infer<typeof MeetingSigningClaimSchema>;
export type MeetingSigningCreationStatus = z.infer<typeof MeetingSigningCreationStatusSchema>;
export type MeetingSigningPersistenceStatus = z.infer<typeof MeetingSigningPersistenceStatusSchema>;
export type MeetingSigningFailureStatus = z.infer<typeof MeetingSigningFailureStatusSchema>;
export type MeetingSigningFailure = z.infer<typeof MeetingSigningFailureSchema>;
