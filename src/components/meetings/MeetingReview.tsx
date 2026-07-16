"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Meeting } from "@/domain/types";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { ErrorState, LoadingState } from "@/components/shared/States";
import { statusLabel, statusText } from "@/components/shared/meetingPresentation";
import { artifactStateFor } from "@/domain/artifact";
import { addTag, removeTag } from "@/domain/tags";
import { canEditTags, canViewSignatureQueue } from "@/domain/permissions";
import { MeetingTabs } from "./MeetingTabs";
import { MeetingActions } from "./MeetingActions";
import { MeetingEditor } from "./MeetingEditor";
import { MeetingSourcePanel } from "./MeetingSourcePanel";
import { AnalysisProgress } from "./AnalysisProgress";
import { ReviewSummary } from "./ReviewSummary";
import { PdfArtifactPanel } from "./PdfArtifactPanel";
import { ReviewHistoryTimeline } from "./ReviewHistoryTimeline";
import { Toast } from "@/components/shared/Toast";

const BASE_TABS = ["Summary", "Minutes", "Motions", "Attendance", "Transcript"] as const;

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MeetingReview({ meetingId, mode }: { meetingId: string; mode: "review" | "signing" | "archive" }) {
  const { repositories, viewer } = useWorkspace();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["meeting", meetingId], queryFn: () => repositories.meetings.get(meetingId) });
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  // AIDEV-NOTE: "Minutes" stays the landing tab; Summary/Document/History are additive.
  const [tab, setTab] = useState("Minutes");
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  useEffect(() => { if (query.data) setMeeting(query.data); }, [query.data]);

  const save = useMutation({
    mutationFn: (content: Pick<Meeting, "minutes" | "attendees" | "motions">) => {
      if (!meeting) throw new Error("Meeting unavailable.");
      return repositories.meetings.updateContent(meeting.id, { ...content, humanOwned: true, expectedVersion: meeting.version, actorName: viewer.name });
    },
    onSuccess: (next) => {
      setMeeting(next);
      client.setQueryData<Meeting>(["meeting", next.id], next);
      client.setQueryData<Meeting[]>(["meetings"], (current) => current?.map((item) => item.id === next.id ? next : item));
      void client.invalidateQueries({ queryKey: ["meetings"] });
      setEditing(false);
      setToast({ text: "Meeting changes saved.", tone: "success" });
    },
    onError: (reason) => setToast({ text: reason instanceof Error ? reason.message : "Save failed.", tone: "error" }),
  });

  const tags = useMutation({
    mutationFn: (nextTags: string[]) => {
      if (!meeting) throw new Error("Meeting unavailable.");
      return repositories.meetings.updateTags(meeting.id, nextTags, { expectedVersion: meeting.version, actorName: viewer.name });
    },
    onSuccess: (next) => {
      setMeeting(next);
      client.setQueryData<Meeting>(["meeting", next.id], next);
      void client.invalidateQueries({ queryKey: ["meetings"] });
    },
    onError: (reason) => setToast({ text: reason instanceof Error ? reason.message : "Tags could not be updated.", tone: "error" }),
  });

  if (query.isLoading) return <LoadingState label="Loading meeting" />;
  if (query.isError) return <ErrorState message="Meeting not found." retry={() => void query.refetch()} />;
  if (!meeting) return <LoadingState label="Loading meeting" />;
  if (mode === "signing" && !canViewSignatureQueue(viewer)) {
    return <div role="alert" className="alert alert-warning"><span>This meeting requires Treasurer access.</span></div>;
  }

  const completed = meeting.status === "COMPLETED";
  const showAnalysis = meeting.status === "AI_PROCESSING" || meeting.status === "AI_FAILED";
  const showDocumentTab = artifactStateFor(meeting.status) !== "not_generated";
  const tabs = [...BASE_TABS, ...(showDocumentTab ? ["Document"] : []), "History"];
  const activeTab = tabs.includes(tab) ? tab : "Minutes";

  return (
    <div>
      <div className="breadcrumbs text-xs">
        <ul>
          <li><Link className="link" href="/app/dashboard">Meeting records</Link></li>
          <li>
            <Link className="link" href={mode === "archive" ? "/app/archive" : mode === "signing" ? "/app/signing" : "/app/needs-review"}>
              {mode === "archive" ? "Archive" : mode === "signing" ? "Signing" : "Needs review"}
            </Link>
          </li>
          <li>{meeting.title}</li>
        </ul>
      </div>
      <article className="card border border-base-300 bg-base-100">
        <header className="flex items-start justify-between gap-3 border-b border-base-300 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-sm font-medium ${statusText[meeting.status]}`}>
                {completed ? "Completed · Immutable" : statusLabel[meeting.status]}
              </span>
              {meeting.humanOwned && !completed && <span className="badge badge-outline badge-sm">Human-owned</span>}
            </div>
            <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
              {completed && (
                <svg aria-label="Locked" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="5" y="10" width="14" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              )}
              <span>{meeting.title}</span>
            </h1>
            <p className="text-sm opacity-55">{meeting.category} · {meeting.date} · version {meeting.version}</p>
          </div>
          {completed && (
            <button className="btn btn-outline btn-sm" onClick={() => setToast({ text: "Demo preview only. No file was downloaded because no signed PDF file exists.", tone: "success" })}>
              Preview signed PDF
            </button>
          )}
        </header>
        {meeting.rejection && (
          <div role="alert" className="alert alert-error rounded-none">
            <span><strong>Returned by {meeting.rejection.by}:</strong> {meeting.rejection.comment}</span>
          </div>
        )}
        {/* AIDEV-NOTE: Archive recovery is automatic per the diagrams — no retry or
            Report Issue exists for ARCHIVE_FAILED; this notice is the whole surface. */}
        {meeting.status === "ARCHIVE_FAILED" && (
          <div role="alert" className="alert rounded-none">
            <span>
              <strong>Archive delivery delayed.</strong> Recovery is automatic in the target workflow; this frontend has no archive worker or user action. The demo signed state remains locked.
            </span>
          </div>
        )}
        <MeetingSourcePanel source={meeting.source} />
        {showAnalysis && <AnalysisProgress meeting={meeting} />}
        <label className="form-control border-b border-base-300 px-4 py-3 sm:hidden">
          <span className="label-text mb-1 text-xs">Meeting section</span>
          <select className="select select-bordered min-h-11 w-full" aria-label="Meeting section" value={activeTab} onChange={(event) => setTab(event.target.value)}>
            {tabs.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <div role="tablist" className="tabs tabs-border hidden flex-nowrap overflow-x-auto px-4 sm:flex">
          {tabs.map((item) => (
            <button role="tab" aria-selected={activeTab === item} key={item} className={`tab min-h-11 whitespace-nowrap ${activeTab === item ? "tab-active" : ""}`} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="p-4 sm:max-h-[55vh] sm:overflow-auto">
          {editing ? (
            <MeetingEditor meeting={meeting} save={(content) => save.mutate(content)} cancel={() => setEditing(false)} busy={save.isPending} />
          ) : activeTab === "Summary" ? (
            <ReviewSummary
              meeting={meeting}
              onOpenTab={setTab}
              canEditTags={canEditTags(viewer, meeting)}
              tagsBusy={tags.isPending}
              onAddTag={(value) => tags.mutate(addTag(meeting.tags, value))}
              onRemoveTag={(value) => tags.mutate(removeTag(meeting.tags, value))}
            />
          ) : activeTab === "Document" ? (
            <div className="space-y-3">
              {completed && (
                <div className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
                  <p><strong>Immutable archived record.</strong> Nothing on this meeting can change.</p>
                  {meeting.archivedAt && <p className="mt-1 text-xs opacity-65">Archived and completed {formatAt(meeting.archivedAt)}.</p>}
                  <p className="mt-1 text-xs opacity-65">Source reference: <span className="break-all font-mono">{meeting.source.reference}</span></p>
                </div>
              )}
              <PdfArtifactPanel meeting={meeting} />
            </div>
          ) : activeTab === "History" ? (
            <ReviewHistoryTimeline history={meeting.history} />
          ) : (
            <MeetingTabs meeting={meeting} tab={activeTab} />
          )}
          {!editing && !showAnalysis && meeting.status !== "ARCHIVE_FAILED" && meeting.failureReason && (
            <div role="alert" className="alert alert-error mt-4"><span>{meeting.failureReason}</span></div>
          )}
        </div>
        {!completed && <MeetingActions meeting={meeting} update={setMeeting} startEdit={() => setEditing(true)} />}
      </article>
      {toast && <Toast message={toast.text} tone={toast.tone} clear={() => setToast(null)} />}
    </div>
  );
}
