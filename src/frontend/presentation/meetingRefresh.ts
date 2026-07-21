import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export const MEETING_QUEUE_REFRESH_MS = 5_000;
export const MEETING_PROCESSING_REFRESH_MS = 2_000;
export const MEETING_SIGNING_REFRESH_MS = 3_000;

export function meetingDetailRefreshInterval(
  meeting: Pick<MeetingApiDetail, "status"> | undefined,
): number | false {
  if (meeting?.status === "AI_PROCESSING" || meeting?.status === "PDF_PROCESSING") {
    return MEETING_PROCESSING_REFRESH_MS;
  }
  if (meeting?.status === "AWAITING_SIGNATURE" || meeting?.status === "ARCHIVE_FAILED") {
    return MEETING_SIGNING_REFRESH_MS;
  }
  return false;
}
