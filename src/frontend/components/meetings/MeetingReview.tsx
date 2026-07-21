"use client";

import Link from "next/link";
import { useState } from "react";
import { useMeeting } from "@/frontend/hooks/useApi";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { statusLabel, statusText } from "@/frontend/components/shared/meetingPresentation";
import { MeetingAnalysisState } from "./MeetingAnalysisState";
import { MeetingTabs, type MeetingTab } from "./MeetingTabs";
import { MeetingSourcePanel } from "./MeetingSourcePanel";
import { ReviewHistoryTimeline } from "./ReviewHistoryTimeline";

const TABS = ["Minutes", "Transcript", "Attendance", "Motions", "History"] as const;
type MeetingReviewTab = (typeof TABS)[number];

export function MeetingReview({ meetingId, mode }: { meetingId: string; mode: "review" | "signing" | "archive" }) {
  const query = useMeeting(meetingId);
  const [tab, setTab] = useState<MeetingReviewTab>("Minutes");
  const heading = <div><div className="breadcrumbs text-xs"><ul><li><Link href="/app/meetings">Meeting records</Link></li><li>{mode}</li></ul></div><h1 className="text-2xl font-semibold">Meeting record</h1></div>;

  if (query.isLoading) return <LoadingState label="Loading meeting" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} /></div>;

  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<ErrorState message="Meeting details were not returned." retry={() => void query.refetch()} /></div>;

  return (
    <div className="grid gap-4">
      {heading}
      <article className="card overflow-hidden border border-base-300 bg-base-100">
        <header className="border-b border-base-300 p-4">
          <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
          <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
          <p className="text-sm opacity-60">{meeting.category} · {meeting.meetingDate} · {meeting.durationMinutes ? `${meeting.durationMinutes} minutes · ` : ""}version {meeting.version}</p>
        </header>
        <MeetingAnalysisState meeting={meeting} />
        <MeetingSourcePanel source={meeting.source} sourceParticipants={meeting.sourceParticipants} />
        <div role="tablist" className="tabs tabs-border overflow-x-auto px-4">
          {TABS.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={`tab ${tab === item ? "tab-active" : ""}`} onClick={() => setTab(item)}>{item}</button>)}
        </div>
        <div className="p-4">
          {tab === "History"
            ? <ReviewHistoryTimeline history={meeting.history} />
            : <MeetingTabs meeting={meeting} tab={tab as MeetingTab} />}
        </div>
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
