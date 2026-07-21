import { z } from "zod";
import type { ApprovedPdfSource } from "../../repositories/storage/approvedPdfSource";
import { supabaseMinutesPdfStorage } from "../../repositories/supabase/supabaseMinutesPdfStorage";
import { meetingReviewService } from "../reviews/meetingReviewService";
import type { MeetingReviewDetail } from "../../../shared/contracts/meetingReview";

const MeetingIdSchema = z.string().uuid();

interface MeetingPdfPreviewReader {
  getMeetingReview(meetingId: string): Promise<MeetingReviewDetail | null>;
}

export type MeetingPdfPreviewResult =
  | { status: "available"; meetingId: string; documentVersion: number; bytes: Uint8Array }
  | { status: "not_found"; meetingId: string }
  | { status: "not_ready"; meetingId: string };

export function createGetMeetingPdfPreview(
  meetingReader: MeetingPdfPreviewReader,
  pdfSource: ApprovedPdfSource,
) {
  return async function getMeetingPdfPreview(meetingIdInput: string): Promise<MeetingPdfPreviewResult> {
    const meetingId = MeetingIdSchema.parse(meetingIdInput);
    const meeting = await meetingReader.getMeetingReview(meetingId);
    if (!meeting) return { status: "not_found", meetingId };
    if (!meeting.pdfArtifact) return { status: "not_ready", meetingId };

    return {
      status: "available",
      meetingId,
      documentVersion: meeting.pdfArtifact.documentVersion,
      bytes: await pdfSource.loadApprovedPdf(meeting.pdfArtifact.path),
    };
  };
}

export const getMeetingPdfPreview = createGetMeetingPdfPreview(
  meetingReviewService,
  supabaseMinutesPdfStorage,
);
