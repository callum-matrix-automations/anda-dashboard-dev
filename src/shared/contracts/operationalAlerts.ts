import { z } from "zod";

export const OperationalAlertStageSchema = z.enum([
  "TRANSCRIPT_IMPORT",
  "AI_ANALYSIS",
  "PDF_GENERATION",
  "SIGNING",
  "ARCHIVE",
  "USER_REPORT",
]);

export const OperationalAlertInputSchema = z.object({
  stage: OperationalAlertStageSchema,
  failureCode: z.string().trim().min(1).max(200),
  meetingId: z.string().uuid().nullable().optional(),
  entityRef: z.string().trim().min(1).max(500).nullable().optional(),
  workflowStatus: z.string().trim().min(1).max(100).nullable().optional(),
  deduplicationKey: z.string().trim().min(1).max(500).optional(),
}).strict().refine((value) => Boolean(value.meetingId || value.entityRef), {
  message: "A meeting ID or entity reference is required.",
});

export const OperationalAlertRecordResultSchema = z.object({
  status: z.enum(["created", "deduplicated"]),
  alertId: z.string().uuid(),
  occurrenceCount: z.number().int().positive(),
  deliveryStatus: z.enum(["PENDING", "PROCESSING", "DELIVERED", "FAILED"]),
}).strict();

export const OperationalAlertDeliveryClaimSchema = z.object({
  alertId: z.string().uuid(),
  runId: z.string().uuid(),
  stage: OperationalAlertStageSchema,
  meetingId: z.string().uuid().nullable(),
  entityRef: z.string().trim().min(1).max(500).nullable(),
  failureCode: z.string().trim().min(1).max(200),
  workflowStatus: z.string().trim().min(1).max(100).nullable(),
  occurredAt: z.string().datetime({ offset: true }),
  attempt: z.number().int().positive(),
}).strict();

export const OperationalAlertPersistenceStatusSchema = z.enum(["saved", "not_found", "stale"]);
export const OperationalAlertFailureStatusSchema = z.enum([
  "retry_scheduled",
  "exhausted",
  "not_found",
  "stale",
]);

export const OperationalIssueReportCommandSchema = z.object({
  meetingId: z.string().uuid(),
  reporterProfileId: z.string().uuid(),
  comment: z.string().trim().min(1).max(2_000).nullable().optional(),
}).strict();

export const OperationalIssueReportResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("created"),
    meetingId: z.string().uuid(),
    reportId: z.string().uuid(),
    alertId: z.string().uuid(),
    alertStatus: z.enum(["created", "deduplicated"]),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "invalid_actor"]),
    meetingId: z.string().uuid(),
  }).strict(),
]);

export const ReportIssueRequestSchema = z.object({
  meetingId: z.string().uuid(),
  comment: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export type OperationalAlertStage = z.infer<typeof OperationalAlertStageSchema>;
export type OperationalAlertInput = z.infer<typeof OperationalAlertInputSchema>;
export type OperationalAlertRecordResult = z.infer<typeof OperationalAlertRecordResultSchema>;
export type OperationalAlertDeliveryClaim = z.infer<typeof OperationalAlertDeliveryClaimSchema>;
export type OperationalIssueReportCommand = z.infer<typeof OperationalIssueReportCommandSchema>;
export type OperationalIssueReportResult = z.infer<typeof OperationalIssueReportResultSchema>;
export type ReportIssueRequest = z.infer<typeof ReportIssueRequestSchema>;
