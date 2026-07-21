"use client";

import { useRetryMeetingPdf, useRetryMeetingSigning } from "@/frontend/hooks/useApi";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export function MeetingWorkflowState({
  meeting,
  onFeedback,
}: {
  meeting: MeetingApiDetail;
  onFeedback: (message: string, tone: "error" | "success") => void;
}) {
  const retryPdf = useRetryMeetingPdf();
  const retrySigning = useRetryMeetingSigning();

  if (meeting.deferredAt) {
    return (
      <div role="status" className="alert alert-warning rounded-none border-x-0 border-t-0">
        <span><strong>Review deferred.</strong> {meeting.deferredNote ?? "No reason was recorded."}</span>
      </div>
    );
  }

  if (meeting.status === "PDF_PROCESSING") {
    return <div role="status" className="alert alert-info rounded-none border-x-0 border-t-0"><span><strong>PDF generation is in progress.</strong> This record will refresh automatically.</span></div>;
  }

  if (meeting.status === "PDF_FAILED") {
    return (
      <div role="alert" className="alert alert-error rounded-none border-x-0 border-t-0">
        <div><strong>PDF generation failed.</strong><p className="mt-1 text-sm">{meeting.failure?.message ?? "The approved minutes PDF could not be generated."}</p></div>
        {meeting.capabilities.canRetryPdf && (
          <button type="button" className="btn btn-sm min-h-11" disabled={retryPdf.isPending} onClick={() => retryPdf.mutate(
            { meetingId: meeting.id, expectedVersion: meeting.version },
            {
              onSuccess: () => onFeedback("PDF generation restarted.", "success"),
              onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
            },
          )}>{retryPdf.isPending ? "Retrying..." : "Retry PDF generation"}</button>
        )}
      </div>
    );
  }

  if (meeting.status === "AWAITING_SIGNATURE") {
    return (
      <div role="status" className="alert alert-success rounded-none border-x-0 border-t-0">
        <div><strong>Delivered to the Treasurer signing queue.</strong><p className="mt-1 text-sm">{artifactSummary(meeting)}</p></div>
      </div>
    );
  }

  if (meeting.status === "ESIGN_FAILED") {
    return (
      <div role="alert" className="alert alert-error rounded-none border-x-0 border-t-0">
        <div><strong>Signing delivery failed.</strong><p className="mt-1 text-sm">{meeting.failure?.message ?? "The PDF could not be delivered to the signing provider."}</p><p className="mt-1 text-xs">{artifactSummary(meeting)}</p></div>
        {meeting.capabilities.canRetrySigning && (
          <button type="button" className="btn btn-sm min-h-11" disabled={retrySigning.isPending} onClick={() => retrySigning.mutate(
            { meetingId: meeting.id, expectedVersion: meeting.version },
            {
              onSuccess: () => onFeedback("Signing delivery restarted.", "success"),
              onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
            },
          )}>{retrySigning.isPending ? "Retrying..." : "Retry signing delivery"}</button>
        )}
      </div>
    );
  }

  return null;
}

function artifactSummary(meeting: MeetingApiDetail): string {
  if (!meeting.pdfArtifact) return "The approved PDF metadata is not available yet.";
  const megabytes = (meeting.pdfArtifact.sizeBytes / 1_000_000).toFixed(2);
  return `Document version ${meeting.pdfArtifact.documentVersion}, ${meeting.pdfArtifact.pageCount} pages, ${megabytes} MB.`;
}
