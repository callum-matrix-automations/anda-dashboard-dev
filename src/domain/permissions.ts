import type { MeetingAction } from "./stateMachine";
import { canDefer, canResume, canTransition, isApprovalTransitionAllowed, isEditingLocked } from "./stateMachine";
import type { Meeting, Viewer } from "./types";

// AIDEV-NOTE: Diagram source of truth. Meeting inheritance is linear:
// user < officer < treasurer. Account Admin is orthogonal. Superadmin is
// internal-only and cannot inherit or exercise any meeting capability.
const ROLE_RANK = { user: 0, officer: 1, treasurer: 2 } as const;

export function hasAtLeastRole(viewer: Viewer, role: keyof typeof ROLE_RANK): boolean {
  return !viewer.isSuperadmin && ROLE_RANK[viewer.role] >= ROLE_RANK[role];
}

export function canAccessMeetings(viewer: Viewer): boolean {
  return !viewer.isSuperadmin;
}

export function canReviewMeetings(viewer: Viewer): boolean {
  return hasAtLeastRole(viewer, "officer");
}

export function canAccessSection(viewer: Viewer, section: string): boolean {
  // AIDEV-NOTE: Settings carries only personal profile/appearance state, so it is the
  // one section every level — including internal Superadmin — may open.
  if (section === "settings") return true;
  if (section === "members") return canManageMembers(viewer) || viewer.isSuperadmin;
  if (["signing"].includes(section)) return canViewSignatureQueue(viewer);
  if (["needs-review", "deferred", "failures"].includes(section)) return canReviewMeetings(viewer);
  if (["dashboard", "meetings", "archive", "search", "reports"].includes(section)) {
    return canAccessMeetings(viewer);
  }
  return false;
}

// Minimum role required to trigger each lifecycle action.
const ACTION_MIN_ROLE: Record<MeetingAction, keyof typeof ROLE_RANK> = {
  AI_RETRY: "officer",
  AI_MARK_MANUAL_READY: "officer",
  AI_COMPLETE: "officer", // system-driven in reality; officer can force in dev
  AI_FAIL: "officer",
  APPROVE: "officer",
  PDF_COMPLETE: "officer",
  PDF_FAIL: "officer",
  PDF_RETRY: "officer",
  SIGN: "treasurer",
  SIGN_FAIL: "treasurer",
  SIGN_RETRY: "treasurer",
  REJECT: "treasurer",
  ARCHIVE_FAIL: "treasurer",
  ARCHIVE_RETRY: "officer",
};

export function canPerform(
  viewer: Viewer,
  meeting: Pick<Meeting, "status" | "deferredAt">,
  action: MeetingAction,
): boolean {
  if (!hasAtLeastRole(viewer, ACTION_MIN_ROLE[action])) return false;
  if (action === "APPROVE") {
    return isApprovalTransitionAllowed(meeting);
  }
  return canTransition(meeting.status, action);
}

export function canEditMeeting(viewer: Viewer, meeting: Pick<Meeting, "status">): boolean {
  return hasAtLeastRole(viewer, "officer") && !isEditingLocked(meeting.status);
}

// AIDEV-NOTE: Tags follow the editing lock exactly: officer+ before approval,
// read-only from PDF_PROCESSING onward, immutable after completion.
export function canEditTags(viewer: Viewer, meeting: Pick<Meeting, "status">): boolean {
  return hasAtLeastRole(viewer, "officer") && !isEditingLocked(meeting.status);
}

export function canDeferMeeting(
  viewer: Viewer,
  meeting: Pick<Meeting, "status" | "deferredAt">,
): boolean {
  return hasAtLeastRole(viewer, "officer") && canDefer(meeting);
}

export function canResumeMeeting(
  viewer: Viewer,
  meeting: Pick<Meeting, "status" | "deferredAt">,
): boolean {
  return hasAtLeastRole(viewer, "officer") && canResume(meeting);
}

export function canViewSignatureQueue(viewer: Viewer): boolean {
  return !viewer.isSuperadmin && viewer.role === "treasurer";
}

export function canManageMembers(viewer: Viewer): boolean {
  return !viewer.isSuperadmin && viewer.isAdmin;
}

export function canChangeMemberRole(
  viewer: Viewer,
  currentRole: Viewer["role"],
  nextRole: Viewer["role"],
): boolean {
  return canManageMembers(viewer)
    && currentRole !== "treasurer"
    && nextRole !== "treasurer"
    && currentRole !== nextRole;
}

export function canManageAdminFlags(viewer: Viewer): boolean {
  return viewer.isSuperadmin;
}

export function canTransferTreasurer(viewer: Viewer): boolean {
  return viewer.isSuperadmin;
}
