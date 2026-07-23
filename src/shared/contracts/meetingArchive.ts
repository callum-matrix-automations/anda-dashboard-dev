import { z } from "zod";

export const MEETING_CATEGORIES = [
  "Board Meeting",
  "Annual General Meeting",
  "Special Session",
  "Committee Meeting",
] as const;

export const MeetingArchiveCategorySchema = z.enum(MEETING_CATEGORIES);

export const MeetingArchiveClaimSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("claimed"),
    meetingId: z.string().uuid(),
    requestId: z.string().uuid(),
    externalRequestId: z.string().trim().min(1),
    documentVersion: z.number().int().positive(),
    runId: z.string().uuid(),
    attempt: z.number().int().positive(),
    unsignedPdfPath: z.string().trim().min(1),
    expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    expectedSizeBytes: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "already_processing", "already_completed", "protected"]),
    meetingId: z.string().uuid(),
    attempt: z.number().int().nonnegative().nullable(),
  }).strict(),
]);

export const MeetingArchiveCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["completed", "already_completed"]),
    meetingId: z.string().uuid(),
    signedPdfId: z.string().uuid(),
    completedAt: z.string().datetime({ offset: true }),
    version: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "stale"]),
    meetingId: z.string().uuid(),
  }).strict(),
]);

export const MeetingArchiveFailurePersistenceSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("failed"),
    meetingId: z.string().uuid(),
    attempt: z.number().int().positive(),
    version: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.enum(["not_found", "already_completed", "stale"]),
    meetingId: z.string().uuid(),
  }).strict(),
]);

export const MeetingArchiveListItemSchema = z.object({
  meetingId: z.string().uuid(),
  title: z.string().trim().min(1),
  meetingDate: z.string().date(),
  category: MeetingArchiveCategorySchema,
  tags: z.array(z.string()),
  signedBy: z.string().uuid(),
  signedAt: z.string().datetime({ offset: true }),
  signedPdfId: z.string().uuid(),
  completedAt: z.string().datetime({ offset: true }),
  version: z.number().int().positive(),
}).strict();

export const MeetingArchiveSearchResultSchema = z.object({
  items: z.array(MeetingArchiveListItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
}).strict();

export const MeetingArchiveMotionSchema = z.object({
  id: z.string().uuid(),
  text: z.string().nullable(),
  outcome: z.enum(["CARRIED", "FAILED", "TABLED", "NOT_SECONDED"]).nullable(),
}).strict();

export const MeetingArchiveDocumentSchema = z.object({
  pdfId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().positive(),
  pageCount: z.number().int().positive(),
  documentVersion: z.number().int().positive(),
}).strict();

export const MeetingArchiveDetailSchema = MeetingArchiveListItemSchema.extend({
  minutes: z.unknown(),
  motions: z.array(MeetingArchiveMotionSchema),
  document: MeetingArchiveDocumentSchema,
}).strict();

export const MeetingArchiveAccessSchema = z.object({
  meetingId: z.string().uuid(),
  pdfId: z.string().uuid(),
  url: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const MeetingArchiveQuerySchema = z.object({
  query: z.string().trim().max(500).optional(),
  year: z.number().int().min(1900).max(2200).optional(),
  category: MeetingArchiveCategorySchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().nonnegative().default(0),
}).strict();

export type MeetingArchiveClaim = z.infer<typeof MeetingArchiveClaimSchema>;
export type MeetingArchiveCompletion = z.infer<typeof MeetingArchiveCompletionSchema>;
export type MeetingArchiveFailurePersistence = z.infer<typeof MeetingArchiveFailurePersistenceSchema>;
export type MeetingArchiveListItem = z.infer<typeof MeetingArchiveListItemSchema>;
export type MeetingArchiveSearchResult = z.infer<typeof MeetingArchiveSearchResultSchema>;
export type MeetingArchiveDetail = z.infer<typeof MeetingArchiveDetailSchema>;
export type MeetingArchiveAccess = z.infer<typeof MeetingArchiveAccessSchema>;
export type MeetingArchiveQuery = z.infer<typeof MeetingArchiveQuerySchema>;
