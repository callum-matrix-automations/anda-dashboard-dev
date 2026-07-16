"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { MeetingTable } from "@/components/shared/MeetingTable";
import { ErrorState, LoadingState } from "@/components/shared/States";
import { canReviewMeetings, canViewSignatureQueue } from "@/domain/permissions";
import type { Meeting } from "@/domain/types";

const copy = { meetings: ["All meetings", "Browse every fixture meeting, transcript, record, and lifecycle status."], "needs-review": ["Needs review", "Approve demo minutes and resolve local lifecycle exceptions."], deferred: ["Deferred", "Fixture records parked while awaiting external information."], signing: ["Signing", "Treasurer decision and archive-status queue for demo records."], archive: ["Archive", "Fixture records in the completed signed state."] } as const;
const urgency = { AI_FAILED: 0, PDF_FAILED: 0, ESIGN_FAILED: 0, PENDING_APPROVAL: 1, AWAITING_SIGNATURE: 1, AI_PROCESSING: 2, PDF_PROCESSING: 2, ARCHIVE_FAILED: 2, COMPLETED: 3 } as const;

export function orderQueueMeetings(meetings: Meeting[], queue: string): Meeting[] {
  if (queue === "meetings") return meetings;
  if (queue !== "archive") return [...meetings].sort((left, right) => urgency[left.status] - urgency[right.status]);
  return [...meetings].sort((left, right) => {
    const recency = (right.archivedAt ?? right.signedAt ?? right.date).localeCompare(left.archivedAt ?? left.signedAt ?? left.date);
    return recency || right.date.localeCompare(left.date) || left.id.localeCompare(right.id);
  });
}

export function QueueScreen({ queue }: { queue: string }) {
  const [archiveSearch, setArchiveSearch] = useState("");
  const { repositories, viewer, flash, setFlash } = useWorkspace();
  const query = useQuery({ queryKey: ["meetings"], queryFn: () => repositories.meetings.list() });
  if (query.isLoading) return <LoadingState/>;
  if (query.isError) return <ErrorState message="Meeting records could not be loaded." retry={() => void query.refetch()}/>;
  if (queue === "signing" && !canViewSignatureQueue(viewer)) return <div role="alert" className="alert alert-warning"><span>Signing records require the Treasurer role.</span></div>;
  const meetings = (query.data ?? [])
    .filter((meeting) => {
      if (queue === "meetings") return true;
      if (queue === "needs-review") {
        return ["AI_PROCESSING", "AI_FAILED", "PENDING_APPROVAL", "PDF_PROCESSING", "PDF_FAILED"].includes(meeting.status)
          && !meeting.deferredAt;
      }
      if (queue === "deferred") return Boolean(meeting.deferredAt);
      if (queue === "signing") return ["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED"].includes(meeting.status);
      return meeting.status === "COMPLETED";
    })
    .filter((meeting) => queue !== "archive" || `${meeting.title} ${meeting.category} ${meeting.date} ${meeting.tags.join(" ")}`.toLowerCase().includes(archiveSearch.toLowerCase()));
  // All Meetings retains repository chronology; task queues use urgency and archive retrieval uses completion recency.
  const visibleMeetings = orderQueueMeetings(meetings, queue);
  const [title, description] = copy[queue as keyof typeof copy] ?? ["Meetings", "Meeting records"];
  const emptyMessage = queue === "meetings"
    ? "No meeting records are available."
    : queue === "archive"
      ? archiveSearch.trim() ? "No signed records match this search." : "No signed records are available."
      : "Nothing needs attention here.";
  return <div>{flash && <div role="status" className="alert alert-success mb-3"><span>{flash}</span><button className="btn btn-ghost min-h-11 min-w-11" aria-label="Dismiss message" onClick={() => setFlash(null)}>✕</button></div>}<div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>{title}</li></ul></div><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm opacity-60">{description}</p></div>{queue==="archive"&&<label className="form-control w-full sm:w-72"><span className="label-text mb-1 text-xs">Search signed records</span><input className="input input-bordered min-h-11" type="search" placeholder="Title, category, or date" value={archiveSearch} onChange={event=>setArchiveSearch(event.target.value)}/></label>}</div>{queue==="archive"&&<div className="mb-3 flex items-center gap-2 text-xs opacity-65"><span className="badge badge-outline">2026</span><span className="ml-auto">{visibleMeetings.length} signed record{visibleMeetings.length===1?"":"s"}</span></div>}<div className="card border border-base-300 bg-base-200"><div className="card-body p-2.5 sm:p-4"><MeetingTable meetings={visibleMeetings} browseAll={queue === "meetings"} reviewAccess={canReviewMeetings(viewer)} signerAccess={canViewSignatureQueue(viewer)} emptyMessage={emptyMessage}/></div></div></div>;
}
