import { z } from "zod";

export const FINANCIAL_RECORD_STATUSES = ["active", "archived", "all"] as const;
export const FinancialRecordStatusSchema = z.enum(FINANCIAL_RECORD_STATUSES);
export type FinancialRecordStatus = z.infer<typeof FinancialRecordStatusSchema>;

export const FINANCIAL_RECORD_MIME_TYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
] as const;
export const FinancialRecordMimeTypeSchema = z.enum(FINANCIAL_RECORD_MIME_TYPES);
export type FinancialRecordMimeType = z.infer<typeof FinancialRecordMimeTypeSchema>;

export const FINANCIAL_RECORD_MAX_BYTES = 25 * 1024 * 1024;
export const FINANCIAL_RECORD_MIN_YEAR = 1900;
export const FINANCIAL_RECORD_MAX_YEAR = 2200;

const isoDateTime = z.string().datetime({ offset: true });
const folderName = z.string().trim().min(1, "Folder name is required.").max(80);
const displayName = z.string().trim().min(1, "Record name is required.").max(180);
const optionalDescription = z.string().trim().max(2_000).nullable();

export const FinancialFolderSchema = z.object({
  id: z.string().uuid(),
  name: folderName,
  isSystem: z.boolean(),
  sortOrder: z.number().int().min(0),
  version: z.number().int().positive(),
  createdBy: z.string().uuid().nullable(),
  updatedBy: z.string().uuid().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
}).strict();
export type FinancialFolder = z.infer<typeof FinancialFolderSchema>;

export const FinancialFolderListResponseSchema = z.object({
  folders: z.array(FinancialFolderSchema),
}).strict();
export type FinancialFolderListResponse = z.infer<typeof FinancialFolderListResponseSchema>;

export const FinancialFolderCreateRequestSchema = z.object({ name: folderName }).strict();
export type FinancialFolderCreateRequest = z.infer<typeof FinancialFolderCreateRequestSchema>;

export const FinancialFolderUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  name: folderName,
}).strict();
export type FinancialFolderUpdateRequest = z.infer<typeof FinancialFolderUpdateRequestSchema>;

export const FinancialRecordMetadataInputSchema = z.object({
  folderId: z.string().uuid(),
  displayName,
  recordYear: z.number().int().min(FINANCIAL_RECORD_MIN_YEAR).max(FINANCIAL_RECORD_MAX_YEAR),
  recordMonth: z.number().int().min(1).max(12),
  description: optionalDescription,
}).strict();
export type FinancialRecordMetadataInput = z.infer<typeof FinancialRecordMetadataInputSchema>;

export const FinancialRecordSchema = FinancialRecordMetadataInputSchema.extend({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  originalFileName: z.string().trim().min(1).max(255),
  mimeType: FinancialRecordMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(FINANCIAL_RECORD_MAX_BYTES),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  archivedBy: z.string().uuid().nullable(),
  archivedAt: isoDateTime.nullable(),
  contentUrl: z.string().min(1),
}).strict();
export type FinancialRecord = z.infer<typeof FinancialRecordSchema>;

export const FinancialRecordListQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  folderId: z.string().uuid().nullable().default(null),
  year: z.coerce.number().int().min(FINANCIAL_RECORD_MIN_YEAR).max(FINANCIAL_RECORD_MAX_YEAR).nullable().default(null),
  month: z.coerce.number().int().min(1).max(12).nullable().default(null),
  status: FinancialRecordStatusSchema.default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
export type FinancialRecordListQuery = z.infer<typeof FinancialRecordListQuerySchema>;

export const FinancialRecordSummarySchema = z.object({
  activeTotal: z.number().int().min(0),
  archivedTotal: z.number().int().min(0),
  activeSizeBytes: z.number().int().min(0),
}).strict();
export type FinancialRecordSummary = z.infer<typeof FinancialRecordSummarySchema>;

export const FinancialRecordListResponseSchema = z.object({
  items: z.array(FinancialRecordSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  summary: FinancialRecordSummarySchema,
}).strict();
export type FinancialRecordListResponse = z.infer<typeof FinancialRecordListResponseSchema>;

export const FinancialRecordUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  record: FinancialRecordMetadataInputSchema,
}).strict();
export type FinancialRecordUpdateRequest = z.infer<typeof FinancialRecordUpdateRequestSchema>;

export const FinancialRecordVersionedRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();
export type FinancialRecordVersionedRequest = z.infer<typeof FinancialRecordVersionedRequestSchema>;
