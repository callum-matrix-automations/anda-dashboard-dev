import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export const MEETING_QUEUE_REFRESH_MS = 5_000;
export const MEETING_PROCESSING_REFRESH_MS = 2_000;

export function meetingDetailRefreshInterval(
  meeting: Pick<MeetingApiDetail, "status"> | undefined,
): number | false {
  return meeting?.status === "AI_PROCESSING" || meeting?.status === "PDF_PROCESSING"
    ? MEETING_PROCESSING_REFRESH_MS
    : false;
}
