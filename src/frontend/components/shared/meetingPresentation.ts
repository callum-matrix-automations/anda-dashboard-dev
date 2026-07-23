import type { MeetingStatus } from "@/shared/types";

export const statusLabel: Record<MeetingStatus, string> = { AI_PROCESSING: "AI processing", AI_FAILED: "AI failed", PENDING_APPROVAL: "Pending approval", PDF_PROCESSING: "PDF processing", PDF_FAILED: "PDF failed", AWAITING_SIGNATURE: "Awaiting signature", ESIGN_FAILED: "Signature failed", ARCHIVE_FAILED: "Archive failed", COMPLETED: "Completed" };
export const statusText: Record<MeetingStatus, string> = { AI_PROCESSING: "", AI_FAILED: "text-error", PENDING_APPROVAL: "", PDF_PROCESSING: "", PDF_FAILED: "text-error", AWAITING_SIGNATURE: "", ESIGN_FAILED: "text-error", ARCHIVE_FAILED: "text-error", COMPLETED: "" };

// AIDEV-NOTE: Status tone drives the shared <StatusBadge>. Failures are destructive,
// completed statuses are success, and actions awaiting an officer or signer are warning.
export type StatusTone = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
export const statusTone: Record<MeetingStatus, StatusTone> = {
  AI_PROCESSING: "outline",
  AI_FAILED: "destructive",
  PENDING_APPROVAL: "warning",
  PDF_PROCESSING: "outline",
  PDF_FAILED: "destructive",
  AWAITING_SIGNATURE: "warning",
  ESIGN_FAILED: "destructive",
  ARCHIVE_FAILED: "destructive",
  COMPLETED: "success",
};
export const statusActionLabel: Record<MeetingStatus, string> = {
  AI_PROCESSING: "Monitor processing",
  AI_FAILED: "Complete draft",
  PENDING_APPROVAL: "Review draft",
  PDF_PROCESSING: "Monitor processing",
  PDF_FAILED: "Resolve PDF failure",
  AWAITING_SIGNATURE: "Sign document",
  ESIGN_FAILED: "Resolve signing failure",
  ARCHIVE_FAILED: "Monitor archive recovery",
  COMPLETED: "View signed record",
};
export const meetingHref = (status: MeetingStatus, id: string) => status === "COMPLETED" ? `/app/archive/${id}` : ["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED"].includes(status) ? `/app/signing/${id}` : `/app/meetings/${id}`;

const SIGNING_STATUSES: readonly MeetingStatus[] = ["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED"];
const REVIEW_STATUSES: readonly MeetingStatus[] = ["AI_FAILED", "PENDING_APPROVAL", "PDF_FAILED"];

export function meetingActionFor(
  status: MeetingStatus,
  id: string,
  options: { browseAll?: boolean; reviewAccess?: boolean; signerAccess?: boolean } = {},
): { label: string; href: string } {
  const { browseAll = false, reviewAccess = false, signerAccess = false } = options;
  // Action labels describe capabilities, so restricted viewers always receive a read-safe route.
  if ((SIGNING_STATUSES.includes(status) && !signerAccess) || (REVIEW_STATUSES.includes(status) && !reviewAccess)) {
    return { label: "View record", href: `/app/meetings/${id}` };
  }
  return {
    label: statusActionLabel[status],
    href: browseAll ? `/app/meetings/${id}` : meetingHref(status, id),
  };
}
