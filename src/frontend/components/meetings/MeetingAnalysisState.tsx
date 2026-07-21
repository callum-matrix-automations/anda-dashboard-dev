"use client";

import { ApiClientError } from "@/frontend/api-client/client";
import { useRetryMeetingAnalysis } from "@/frontend/hooks/useApi";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export function MeetingAnalysisState({ meeting }: { meeting: MeetingApiDetail }) {
  const retry = useRetryMeetingAnalysis();

  if (meeting.status === "AI_PROCESSING") {
    return (
      <div role="status" className="alert alert-info rounded-none border-x-0 border-t-0">
        <span><strong>AI analysis is in progress.</strong> The transcript has been stored and this record will update automatically when the draft is ready.</span>
      </div>
    );
  }

  if (meeting.status !== "AI_FAILED") return null;

  return (
    <div role="alert" className="alert alert-error rounded-none border-x-0 border-t-0">
      <div className="min-w-0">
        <strong>AI analysis failed.</strong>
        <p className="mt-1 text-sm">{meeting.failure?.message ?? "The draft could not be generated."}</p>
        {meeting.failure?.at && <p className="mt-1 text-xs opacity-75">Failed {formatAt(meeting.failure.at)}</p>}
        {retry.isSuccess && <p role="status" className="mt-2 text-sm">Retry completed. Refreshing the meeting record…</p>}
        {retry.isError && <p className="mt-2 text-sm">{retryErrorMessage(retry.error)}</p>}
        {!meeting.capabilities.canRetryAnalysis && (
          <p className="mt-2 text-xs opacity-75">Automatic retry is unavailable for this record.</p>
        )}
      </div>
      {meeting.capabilities.canRetryAnalysis && (
        <button
          type="button"
          className="btn btn-sm min-h-11"
          disabled={retry.isPending}
          onClick={() => retry.mutate({ meetingId: meeting.id, expectedVersion: meeting.version })}
        >
          {retry.isPending ? "Retrying analysis…" : "Retry AI analysis"}
        </button>
      )}
    </div>
  );
}

function retryErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "version_conflict") {
    return "This meeting changed before the retry started. Refresh the record and try again.";
  }
  return error instanceof Error ? error.message : "The analysis retry could not be completed.";
}

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
