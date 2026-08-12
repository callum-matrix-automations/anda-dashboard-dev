import { z } from "zod";

// AIDEV-NOTE: Exactly nine lifecycle statuses — the fixed pipeline. "Deferred" is NOT
// a status; it is orthogonal metadata (deferredAt/deferredNote) so a deferred meeting
// keeps its true pipeline position while parked.
export const MEETING_STATUSES = [
  "AI_PROCESSING",
  "AI_FAILED",
  "PENDING_APPROVAL",
  "PDF_PROCESSING",
  "PDF_FAILED",
  "AWAITING_SIGNATURE",
  "ESIGN_FAILED",
  "ARCHIVE_FAILED",
  "COMPLETED",
] as const;

export const MeetingStatusSchema = z.enum(MEETING_STATUSES);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const ROLES = ["user", "officer", "treasurer"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

// AIDEV-NOTE: Account Admin is an independent flag. Superadmin is an internal-only
// identity with no meeting access and is deliberately outside role inheritance.
export const ViewerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: RoleSchema,
  isAdmin: z.boolean(),
  isSuperadmin: z.boolean(),
});
export type Viewer = z.infer<typeof ViewerSchema>;

export const VoteResultSchema = z.enum(["yes", "no", "abstain", "unresolved"]);
export type VoteResult = z.infer<typeof VoteResultSchema>;

export const VoteSchema = z.object({
  memberId: z.string(),
  memberName: z.string(),
  result: VoteResultSchema,
});
export type Vote = z.infer<typeof VoteSchema>;

export const MotionSchema = z.object({
  id: z.string(),
  title: z.string(),
  movedBy: z.string(),
  secondedBy: z.string().nullable(),
  outcome: z.enum(["passed", "failed", "tabled", "pending"]),
  votes: z.array(VoteSchema),
});
export type Motion = z.infer<typeof MotionSchema>;

export const AttendeeSchema = z.object({
  memberId: z.string(),
  name: z.string().trim().min(1),
  role: z.string().trim().min(1),
  present: z.boolean(),
});
export type Attendee = z.infer<typeof AttendeeSchema>;

export const MinutesSectionSchema = z.object({
  id: z.string(),
  heading: z.string().trim().min(1, "Minutes heading is required."),
  body: z.string().trim().min(1, "Minutes body is required."),
});
export type MinutesSection = z.infer<typeof MinutesSectionSchema>;

// AIDEV-NOTE: Provenance records whether transcript evidence came from the configured
// capture provider or the manual user-testing upload path. It remains read-only after
// ingestion and surfaces on meeting detail through the Meeting Source panel.
export const TRANSCRIPT_IMPORT_STATUSES = ["imported", "imported_with_gaps", "import_failed"] as const;
export const TranscriptImportStatusSchema = z.enum(TRANSCRIPT_IMPORT_STATUSES);
export type TranscriptImportStatus = z.infer<typeof TranscriptImportStatusSchema>;

// AIDEV-NOTE: Unmatched speakers stay in the raw transcript but are excluded from
// structured attendance/voting until resolved — hence the discriminated shape: a
// matched participant MUST carry a member identity, an unmatched one MUST say why.
const participantBase = { id: z.string(), displayName: z.string().trim().min(1) };
export const SourceParticipantSchema = z.discriminatedUnion("matched", [
  z.object({ ...participantBase, matched: z.literal(true), memberId: z.string().min(1), memberName: z.string().trim().min(1) }),
  z.object({ ...participantBase, matched: z.literal(false), reason: z.string().trim().min(1) }),
]);
export type SourceParticipant = z.infer<typeof SourceParticipantSchema>;
export type MatchedParticipant = Extract<SourceParticipant, { matched: true }>;
export type UnmatchedParticipant = Extract<SourceParticipant, { matched: false }>;

export const MeetingSourceSchema = z.object({
  provider: z.string().trim().min(1),
  reference: z.string().trim().min(1),
  importedAt: z.string(),
  importStatus: TranscriptImportStatusSchema,
  participants: z.array(SourceParticipantSchema),
});
export type MeetingSource = z.infer<typeof MeetingSourceSchema>;

// AIDEV-NOTE: Frontend-only artifact metadata — a product-quality placeholder, never a
// fake binary. State (processing/unsigned/signed) derives from meeting status in
// domain/artifact.ts; this object only carries display metadata.
export const DocumentArtifactSchema = z.object({
  name: z.string().trim().min(1),
  version: z.number().int().positive(),
  generatedAt: z.string().nullable(),
  pageCount: z.number().int().positive().nullable(),
  sizeLabel: z.string().nullable(),
});
export type DocumentArtifact = z.infer<typeof DocumentArtifactSchema>;

export const HISTORY_ACTIONS = [
  "imported",
  "analysis_started",
  "analysis_completed",
  "analysis_failed",
  "analysis_retried",
  "edit_saved",
  "marked_ready",
  "deferred",
  "resumed",
  "approved",
  "pdf_generated",
  "pdf_failed",
  "pdf_retried",
  "rejected",
  "signed",
  "signature_failed",
  "signature_retried",
  "archived",
  "archive_failed",
  "tags_updated",
] as const;
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

// AIDEV-NOTE: Append-only audit trail. .strict() enforces the diagram decision that
// history records actions, never field-level snapshots of the record.
export const ReviewHistoryEntrySchema = z
  .object({
    id: z.string(),
    actor: z.string().trim().min(1),
    action: z.enum(HISTORY_ACTIONS),
    at: z.string(),
    note: z.string().nullable(),
  })
  .strict();
export type ReviewHistoryEntry = z.infer<typeof ReviewHistoryEntrySchema>;

export const MeetingTagSchema = z.string().trim().min(1).max(40);

export const MeetingCategorySchema = z.enum([
  "Board Meeting",
  "Annual General Meeting",
  "Special Session",
  "Committee Meeting",
]);
export type MeetingCategory = z.infer<typeof MeetingCategorySchema>;

export const MeetingSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: MeetingCategorySchema,
  date: z.string(), // ISO date
  status: MeetingStatusSchema,
  // AIDEV-NOTE: version powers optimistic locking; every successful write increments it.
  version: z.number().int().nonnegative(),
  deferredAt: z.string().nullable(),
  deferredNote: z.string().nullable(),
  failureReason: z.string().nullable(),
  rejection: z
    .object({ by: z.string(), comment: z.string(), at: z.string() })
    .nullable(),
  signedBy: z.string().nullable(),
  signedAt: z.string().nullable(),
  // AIDEV-NOTE: Once a human edits AI output, retries may never replace the owned content.
  humanOwned: z.boolean().default(false),
  source: MeetingSourceSchema,
  // Zero before the first claim, then the current automatic-analysis attempt (1..3).
  analysisAttempt: z.number().int().min(0).max(3).default(0),
  tags: z.array(MeetingTagSchema).max(20).default([]),
  pdfArtifact: DocumentArtifactSchema.nullable().default(null),
  archivedAt: z.string().nullable().default(null),
  history: z.array(ReviewHistoryEntrySchema).default([]),
  minutes: z.array(MinutesSectionSchema),
  attendees: z.array(AttendeeSchema),
  motions: z.array(MotionSchema),
  transcript: z.string(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingContentSchema = z.object({
  minutes: z.array(MinutesSectionSchema),
  attendees: z.array(AttendeeSchema),
  motions: z.array(MotionSchema),
});

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: RoleSchema,
  isAdmin: z.boolean(),
  active: z.boolean(),
  position: z.string(),
  termEnd: z.string(), // ISO date
});
export type Member = z.infer<typeof MemberSchema>;

export const FinancialLineSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.enum(["income", "expense", "reserve"]),
  budgeted: z.number(),
  actual: z.number(),
  period: z.string(),
});
export type FinancialLine = z.infer<typeof FinancialLineSchema>;

export const VendorSchema = z.object({
  id: z.string(),
  name: z.string(),
  service: z.string(),
  contractEnd: z.string(),
  status: z.enum(["active", "expiring", "suspended"]),
  annualSpend: z.number(),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const WebContactSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  subject: z.string(),
  message: z.string(),
  receivedAt: z.string(),
  handled: z.boolean(),
});
export type WebContact = z.infer<typeof WebContactSchema>;

export const ArchiveEntrySchema = z.object({
  meetingId: z.string(),
  title: z.string(),
  category: MeetingCategorySchema,
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  archivedAt: z.string(),
});
export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
