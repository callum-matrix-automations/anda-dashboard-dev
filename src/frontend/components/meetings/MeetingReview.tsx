"use client";

import Link from "next/link";
import { useState } from "react";
import { useMeeting, useSaveMeetingDraft } from "@/frontend/hooks/useApi";
import { ApiClientError } from "@/frontend/api-client/client";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { Toast } from "@/frontend/components/shared/Toast";
import { statusLabel, statusText } from "@/frontend/components/shared/meetingPresentation";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import type { MeetingReviewDraft } from "@/shared/contracts/meetingReview";
import { MeetingAnalysisState } from "./MeetingAnalysisState";
import { MeetingEditor } from "./MeetingEditor";
import { MeetingPdfPreview } from "./MeetingPdfPreview";
import { MeetingReviewActions } from "./MeetingReviewActions";
import { MeetingTabs, type MeetingTab } from "./MeetingTabs";
import { MeetingSourcePanel } from "./MeetingSourcePanel";
import { MeetingWorkflowState } from "./MeetingWorkflowState";
import { ReviewHistoryTimeline } from "./ReviewHistoryTimeline";
import { TreasurerRejectionNotice } from "./TreasurerRejectionNotice";

const TABS = ["Minutes", "Transcript", "Attendance", "Motions", "History"] as const;
type MeetingReviewTab = (typeof TABS)[number];

export function MeetingReview({ meetingId, mode }: { meetingId: string; mode: "review" | "signing" | "archive" }) {
  const query = useMeeting(meetingId);
  const saveDraft = useSaveMeetingDraft();
  const [tab, setTab] = useState<MeetingReviewTab>("Minutes");
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const heading = <div><div className="breadcrumbs text-xs"><ul><li><Link href="/app/meetings">Meeting records</Link></li><li>{mode}</li></ul></div><h1 className="text-2xl font-semibold">Meeting record</h1></div>;

  if (query.isLoading) return <LoadingState label="Loading meeting" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} /></div>;

  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<ErrorState message="Meeting details were not returned." retry={() => void query.refetch()} /></div>;

  const showFeedback = (message: string, tone: "error" | "success") => setFeedback({ message, tone });
  const save = (draft: MeetingReviewDraft) => saveDraft.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version, draft },
    {
      onSuccess: () => { setEditing(false); showFeedback("Meeting draft saved.", "success"); },
      onError: (error) => {
        if (error instanceof ApiClientError && error.code === "version_conflict") setEditing(false);
        showFeedback(meetingMutationErrorMessage(error), "error");
      },
    },
  );

  return (
    <div className="grid gap-4">
      {heading}
      {feedback && <Toast message={feedback.message} tone={feedback.tone} clear={() => setFeedback(null)} />}
      <article className="card overflow-hidden border border-base-300 bg-base-100">
        <header className="grid gap-4 border-b border-base-300 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
          <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
          <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
          <p className="text-sm opacity-60">{meeting.category} · {meeting.meetingDate} · {meeting.durationMinutes ? `${meeting.durationMinutes} minutes · ` : ""}version {meeting.version}</p>
          {meeting.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Meeting tags">
              {meeting.tags.map((tag) => <span className="badge badge-outline" key={tag}>{tag}</span>)}
            </div>
          )}
          </div>
          <MeetingPdfPreview meeting={meeting} />
        </header>
        <MeetingAnalysisState meeting={meeting} />
        <TreasurerRejectionNotice meeting={meeting} />
        <MeetingWorkflowState meeting={meeting} onFeedback={showFeedback} />
        <MeetingSourcePanel source={meeting.source} sourceParticipants={meeting.sourceParticipants} />
        {editing ? (
          <div className="p-4">
            <MeetingEditor key={meeting.version} meeting={meeting} save={save} cancel={() => setEditing(false)} busy={saveDraft.isPending} />
          </div>
        ) : (
          <>
            <div role="tablist" className="tabs tabs-border overflow-x-auto px-4">
              {TABS.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={`tab ${tab === item ? "tab-active" : ""}`} onClick={() => setTab(item)}>{item}</button>)}
            </div>
            <div className="p-4">
              {tab === "History"
                ? <ReviewHistoryTimeline history={meeting.history} />
                : <MeetingTabs meeting={meeting} tab={tab as MeetingTab} />}
            </div>
          </>
        )}
        <MeetingReviewActions meeting={meeting} editing={editing} onEdit={() => setEditing(true)} onFeedback={showFeedback} />
        <footer className="border-t border-base-300 p-4 text-xs opacity-60">
          Source transcripts are read-only. Last updated {formatAt(meeting.updatedAt)}.
        </footer>
      </article>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Meeting details could not be loaded.";
}

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
