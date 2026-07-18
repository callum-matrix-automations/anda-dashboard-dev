import type { Meeting } from "@/shared/types";

type NavigationMeeting = Pick<Meeting, "status" | "deferredAt">;

const reviewStatuses = new Set<Meeting["status"]>([
  "AI_PROCESSING",
  "AI_FAILED",
  "PENDING_APPROVAL",
  "PDF_PROCESSING",
  "PDF_FAILED",
]);

const signingStatuses = new Set<Meeting["status"]>([
  "AWAITING_SIGNATURE",
  "ESIGN_FAILED",
  "ARCHIVE_FAILED",
]);

export function getNavigationTaskCounts(meetings: NavigationMeeting[]) {
  return meetings.reduce(
    (counts, meeting) => {
      // AIDEV-NOTE: Deferral is orthogonal metadata; deferred records leave review
      // until resumed, while all signature-stage failures remain actionable work.
      if (!meeting.deferredAt && reviewStatuses.has(meeting.status)) {
        counts.needsReview += 1;
      }
      if (signingStatuses.has(meeting.status)) {
        counts.signing += 1;
      }
      return counts;
    },
    { needsReview: 0, signing: 0 },
  );
}
