import type { Meeting, MeetingStatus } from "./types";

// AIDEV-NOTE: Single source of truth for lifecycle transitions. Pure functions only —
// no I/O, no clocks (timestamps are passed in) so behavior is fully deterministic.

export type MeetingAction =
  | "AI_RETRY" // AI_FAILED -> AI_PROCESSING
  | "AI_MARK_MANUAL_READY" // AI_FAILED -> PENDING_APPROVAL (manual minutes)
  | "AI_COMPLETE" // AI_PROCESSING -> PENDING_APPROVAL
  | "AI_FAIL" // AI_PROCESSING -> AI_FAILED
  | "APPROVE" // PENDING_APPROVAL -> PDF_PROCESSING (locks editing)
  | "PDF_COMPLETE" // PDF_PROCESSING -> AWAITING_SIGNATURE
  | "PDF_FAIL" // PDF_PROCESSING -> PDF_FAILED
  | "PDF_RETRY" // PDF_FAILED -> PDF_PROCESSING
  | "SIGN" // AWAITING_SIGNATURE -> COMPLETED (archive success) — see archive note
  | "SIGN_FAIL" // AWAITING_SIGNATURE -> ESIGN_FAILED
  | "SIGN_RETRY" // ESIGN_FAILED -> AWAITING_SIGNATURE
  | "REJECT" // AWAITING_SIGNATURE | ESIGN_FAILED -> PENDING_APPROVAL (mandatory comment)
  | "ARCHIVE_FAIL" // signing succeeded but archival failed -> ARCHIVE_FAILED
  | "ARCHIVE_RETRY"; // ARCHIVE_FAILED -> COMPLETED

export type StatusOnlyMeetingAction = Exclude<MeetingAction, "REJECT">;

// AIDEV-NOTE: Treasurer REJECT is the ONLY backward edge that reopens editing.
// AIDEV-NOTE: SIGN targets COMPLETED; the archive step is simulated inside the sign
// operation — ARCHIVE_FAIL is a distinct action so fixtures/demos can land there.
const TRANSITIONS: Record<MeetingAction, { from: MeetingStatus[]; to: MeetingStatus }> = {
  AI_RETRY: { from: ["AI_FAILED"], to: "AI_PROCESSING" },
  AI_MARK_MANUAL_READY: { from: ["AI_FAILED"], to: "PENDING_APPROVAL" },
  AI_COMPLETE: { from: ["AI_PROCESSING"], to: "PENDING_APPROVAL" },
  AI_FAIL: { from: ["AI_PROCESSING"], to: "AI_FAILED" },
  APPROVE: { from: ["PENDING_APPROVAL"], to: "PDF_PROCESSING" },
  PDF_COMPLETE: { from: ["PDF_PROCESSING"], to: "AWAITING_SIGNATURE" },
  PDF_FAIL: { from: ["PDF_PROCESSING"], to: "PDF_FAILED" },
  PDF_RETRY: { from: ["PDF_FAILED"], to: "PDF_PROCESSING" },
  SIGN: { from: ["AWAITING_SIGNATURE"], to: "COMPLETED" },
  SIGN_FAIL: { from: ["AWAITING_SIGNATURE"], to: "ESIGN_FAILED" },
  SIGN_RETRY: { from: ["ESIGN_FAILED"], to: "AWAITING_SIGNATURE" },
  REJECT: { from: ["AWAITING_SIGNATURE", "ESIGN_FAILED"], to: "PENDING_APPROVAL" },
  ARCHIVE_FAIL: { from: ["AWAITING_SIGNATURE"], to: "ARCHIVE_FAILED" },
  ARCHIVE_RETRY: { from: ["ARCHIVE_FAILED"], to: "COMPLETED" },
};

// AIDEV-NOTE: Editing locks at APPROVE time: from PDF_PROCESSING onward the record is
// read-only. Only PENDING_APPROVAL and the pre-approval failure state allow edits.
const EDITABLE_STATUSES: readonly MeetingStatus[] = ["PENDING_APPROVAL", "AI_FAILED"];
const APPROVAL_LOCKED_STATUSES: readonly MeetingStatus[] = [
  "PDF_PROCESSING",
  "PDF_FAILED",
  "AWAITING_SIGNATURE",
  "ESIGN_FAILED",
  "ARCHIVE_FAILED",
  "COMPLETED",
];

export function canTransition(status: MeetingStatus, action: MeetingAction): boolean {
  return TRANSITIONS[action].from.includes(status);
}

export function transitionTarget(action: MeetingAction): MeetingStatus {
  return TRANSITIONS[action].to;
}

export type TransitionResult =
  | { ok: true; status: MeetingStatus }
  | { ok: false; error: string };

function transitionCore(status: MeetingStatus, action: MeetingAction): TransitionResult {
  if (status === "COMPLETED") {
    return { ok: false, error: "Completed meetings are immutable." };
  }
  if (!canTransition(status, action)) {
    return { ok: false, error: `Action ${action} is not allowed from ${status}.` };
  }
  return { ok: true, status: TRANSITIONS[action].to };
}

export function transition(status: MeetingStatus, action: StatusOnlyMeetingAction): TransitionResult {
  return transitionCore(status, action);
}

// The transition table models status legality; this helper enforces the payload
// condition that authorizes the sole backward edge at every repository write boundary.
export function requireRejectionComment(comment: string | undefined): string {
  const normalized = comment?.trim();
  if (!normalized) throw new Error("A rejection comment is required.");
  return normalized;
}

export type RejectionTransitionResult =
  | { ok: true; status: MeetingStatus; comment: string }
  | { ok: false; error: string };

export function transitionRejection(status: MeetingStatus, comment: string | undefined): RejectionTransitionResult {
  const normalizedComment = requireRejectionComment(comment);
  const result = transitionCore(status, "REJECT");
  return result.ok ? { ...result, comment: normalizedComment } : result;
}

export function isEditingLocked(status: MeetingStatus): boolean {
  return !EDITABLE_STATUSES.includes(status);
}

// Approval lock is narrower than editing lock: analysis is temporarily read-only,
// but only PDF_PROCESSING and later states represent an approved immutable snapshot.
export function isApprovalLocked(status: MeetingStatus): boolean {
  return APPROVAL_LOCKED_STATUSES.includes(status);
}

export function isImmutable(status: MeetingStatus): boolean {
  return status === "COMPLETED";
}

export function isDeferred(meeting: Pick<Meeting, "deferredAt">): boolean {
  return meeting.deferredAt !== null;
}

// AIDEV-NOTE: Deferral is orthogonal — it never changes status, and is only meaningful
// while the record still needs human review (pre-approval states).
const DEFERRABLE_STATUSES: readonly MeetingStatus[] = ["PENDING_APPROVAL", "AI_FAILED"];

export function canDefer(meeting: Pick<Meeting, "status" | "deferredAt">): boolean {
  return meeting.deferredAt === null && DEFERRABLE_STATUSES.includes(meeting.status);
}

export function canResume(meeting: Pick<Meeting, "status" | "deferredAt">): boolean {
  return meeting.deferredAt !== null && DEFERRABLE_STATUSES.includes(meeting.status);
}

export function isApprovalTransitionAllowed(meeting: Pick<Meeting, "status" | "deferredAt">): boolean {
  return meeting.deferredAt === null && canTransition(meeting.status, "APPROVE");
}

export function countUnresolvedVotes(meeting: Pick<Meeting, "motions">): number {
  return meeting.motions.reduce(
    (sum, motion) => sum + motion.votes.filter((v) => v.result === "unresolved").length,
    0,
  );
}

export const FAILURE_STATUSES: readonly MeetingStatus[] = [
  "AI_FAILED",
  "PDF_FAILED",
  "ESIGN_FAILED",
  "ARCHIVE_FAILED",
];

// AIDEV-NOTE: Archive recovery is AUTOMATIC per the diagrams — no user-facing retry.
// ARCHIVE_RETRY remains a valid system-driven transition, but retryActionFor maps
// ARCHIVE_FAILED to null so no UI ever renders a manual retry control for it.
export function retryActionFor(status: MeetingStatus): MeetingAction | null {
  switch (status) {
    case "AI_FAILED":
      return "AI_RETRY";
    case "PDF_FAILED":
      return "PDF_RETRY";
    case "ESIGN_FAILED":
      return "SIGN_RETRY";
    default:
      return null;
  }
}
