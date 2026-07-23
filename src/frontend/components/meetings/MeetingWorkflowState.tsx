"use client";

import {
  useCheckMeetingSigningStatus,
  useRetryMeetingPdf,
  useRetryMeetingSigning,
  useRetryMeetingSigningOutcome,
} from "@/frontend/hooks/useApi";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import { StatusBanner } from "./StatusBanner";
import { Button } from "@/frontend/components/design-system/primitives/button";
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
  const retrySigningOutcome = useRetryMeetingSigningOutcome();
  const checkSigningStatus = useCheckMeetingSigningStatus();

  const runSigningStatusCheck = () => checkSigningStatus.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version },
    {
      onSuccess: () => onFeedback("Firma signing status checked.", "success"),
      onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
    },
  );
  const runSigningOutcomeRetry = () => retrySigningOutcome.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version },
    {
      onSuccess: () => onFeedback("Firma completion processing restarted.", "success"),
      onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
    },
  );

  if (meeting.deferredAt) {
    return (
      <StatusBanner tone="warning">
        <span><strong>Review deferred.</strong> {meeting.deferredNote ?? "No reason was recorded."}</span>
      </StatusBanner>
    );
  }

  if (meeting.status === "PDF_PROCESSING") {
    return <StatusBanner tone="info"><span><strong>PDF generation is in progress.</strong> This record will refresh automatically.</span></StatusBanner>;
  }

  if (meeting.status === "PDF_FAILED") {
    return (
      <StatusBanner tone="error" role="alert">
        <div><strong>PDF generation failed.</strong><p className="mt-1 text-sm">{meeting.failure?.message ?? "The approved minutes PDF could not be generated."}</p></div>
        {meeting.capabilities.canRetryPdf && (
          <Button type="button" size="sm" loading={retryPdf.isPending} disabled={retryPdf.isPending} onClick={() => retryPdf.mutate(
            { meetingId: meeting.id, expectedVersion: meeting.version },
            {
              onSuccess: () => onFeedback("PDF generation restarted.", "success"),
              onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
            },
          )}>{retryPdf.isPending ? "Retrying..." : "Retry PDF generation"}</Button>
        )}
      </StatusBanner>
    );
  }

  if (meeting.status === "AWAITING_SIGNATURE") {
    return (
      <StatusBanner tone="success">
        <div><strong>Delivered to the Treasurer signing queue.</strong><p className="mt-1 text-sm">{artifactSummary(meeting)}</p></div>
        {meeting.capabilities.canCheckSigningStatus && (
          <Button type="button" size="sm" loading={checkSigningStatus.isPending} disabled={checkSigningStatus.isPending} onClick={runSigningStatusCheck}>
            {checkSigningStatus.isPending ? "Checking..." : "Check signing status"}
          </Button>
        )}
      </StatusBanner>
    );
  }

  if (meeting.status === "ESIGN_FAILED") {
    return (
      <StatusBanner tone="error" role="alert">
        <div><strong>Signing delivery failed.</strong><p className="mt-1 text-sm">{meeting.failure?.message ?? "The PDF could not be delivered to the signing provider."}</p><p className="mt-1 text-xs">{artifactSummary(meeting)}</p></div>
        <div className="flex flex-wrap gap-2">
          {meeting.capabilities.canRetrySigning && (
            <Button type="button" size="sm" loading={retrySigning.isPending} disabled={retrySigning.isPending || retrySigningOutcome.isPending} onClick={() => retrySigning.mutate(
              { meetingId: meeting.id, expectedVersion: meeting.version },
              {
                onSuccess: () => onFeedback("Signing delivery restarted.", "success"),
                onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
              },
            )}>{retrySigning.isPending ? "Retrying..." : "Retry signing delivery"}</Button>
          )}
          {meeting.capabilities.canRetrySigningOutcome && (
            <Button type="button" size="sm" variant="outline" loading={retrySigningOutcome.isPending} disabled={retrySigning.isPending || retrySigningOutcome.isPending} onClick={runSigningOutcomeRetry}>
              {retrySigningOutcome.isPending ? "Retrying..." : "Retry completion check"}
            </Button>
          )}
        </div>
      </StatusBanner>
    );
  }

  if (meeting.status === "ARCHIVE_FAILED") {
    return (
      <StatusBanner tone="error" role="alert">
        <div>
          <strong>The signature was completed, but archival is delayed.</strong>
          <p className="mt-1 text-sm">{meeting.failure?.message ?? "ANDA could not store the verified signed PDF."}</p>
          <p className="mt-1 text-xs">The record remains permanently locked. Automatic recovery will continue; no manual archive retry is required.</p>
        </div>
      </StatusBanner>
    );
  }

  return null;
}

function artifactSummary(meeting: MeetingApiDetail): string {
  if (!meeting.pdfArtifact) return "The approved PDF metadata is not available yet.";
  const megabytes = (meeting.pdfArtifact.sizeBytes / 1_000_000).toFixed(2);
  return `Document version ${meeting.pdfArtifact.documentVersion}, ${meeting.pdfArtifact.pageCount} pages, ${megabytes} MB.`;
}
