"use client";

import Link from "next/link";
import { useState } from "react";
import { useMeeting } from "@/frontend/hooks/useApi";
import { LoadingState } from "@/frontend/components/shared/States";
import { BackendUnavailable } from "@/frontend/components/shared/BackendUnavailable";
import { statusLabel, statusText } from "@/frontend/components/shared/meetingPresentation";
import { MeetingTabs } from "./MeetingTabs";
import { MeetingSourcePanel } from "./MeetingSourcePanel";
import { ReviewHistoryTimeline } from "./ReviewHistoryTimeline";

const TABS = ["Minutes", "Attendance", "Motions", "History"] as const;

export function MeetingReview({ meetingId, mode }: { meetingId: string; mode: "review" | "signing" | "archive" }) {
  const query = useMeeting(meetingId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Minutes");
  const heading = <div><div className="breadcrumbs text-xs"><ul><li><Link href="/app/meetings">Meeting records</Link></li><li>{mode}</li></ul></div><h1 className="text-2xl font-semibold">Meeting record</h1></div>;

  if (query.isLoading) return <LoadingState label="Loading meeting" />;
  if (query.isError) return <div className="grid gap-4">{heading}<BackendUnavailable resource="Meeting details" /></div>;

  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<BackendUnavailable resource="Meeting details" /></div>;
  return <div className="grid gap-4">{heading}<article className="card border border-base-300 bg-base-100"><header className="border-b border-base-300 p-4"><span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span><h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2><p className="text-sm opacity-60">{meeting.category} · {meeting.date} · version {meeting.version}</p></header><MeetingSourcePanel source={meeting.source} /><div role="tablist" className="tabs tabs-border px-4">{TABS.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={`tab ${tab === item ? "tab-active" : ""}`} onClick={() => setTab(item)}>{item}</button>)}</div><div className="p-4">{tab === "History" ? <ReviewHistoryTimeline history={meeting.history} /> : <MeetingTabs meeting={meeting} tab={tab} />}</div><footer className="border-t border-base-300 p-4"><p className="text-sm opacity-60">Updates and lifecycle actions will be enabled when the backend API is implemented.</p></footer></article></div>;
}
