"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useMeeting, useSaveMeetingDraft } from "@/frontend/hooks/useApi";
import { ApiClientError } from "@/frontend/api-client/client";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { StatusBadge } from "@/frontend/components/shared/StatusBadge";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/frontend/components/design-system/primitives/tabs";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import { meetingApprovalMotionIssues } from "@/frontend/presentation/meetingApprovalReadiness";
import type { MeetingReviewDraft } from "@/shared/contracts/meetingReview";
import { MeetingAnalysisState } from "./MeetingAnalysisState";
import {
  MeetingAttendanceEditor,
  MeetingMinutesEditor,
  MeetingMotionsEditor,
} from "./MeetingTabEditors";
import { MeetingPdfPreview } from "./MeetingPdfPreview";
import { MeetingReviewActions } from "./MeetingReviewActions";
import { MeetingTabs, type MeetingTab } from "./MeetingTabs";
import { MeetingSourcePanel } from "./MeetingSourcePanel";
import { MeetingWorkflowState } from "./MeetingWorkflowState";
import { ReviewHistoryTimeline } from "./ReviewHistoryTimeline";
import { TreasurerRejectionNotice } from "./TreasurerRejectionNotice";

const TABS = ["Minutes", "Transcript", "Attendance", "Motions", "History"] as const;
type MeetingReviewTab = (typeof TABS)[number];
type EditableMeetingTab = "Minutes" | "Attendance" | "Motions";

// AIDEV-NOTE: Feedback now flows through Sonner (toast) rather than the old inline Toast.
// The `onFeedback(message, tone)` contract handed to child components is unchanged, so their
// tests still pass; here we simply route it to toast.success/error.
function notify(message: string, tone: "error" | "success") {
  if (tone === "success") toast.success(message);
  else toast.error(message);
}

export function MeetingReview({ meetingId, mode }: { meetingId: string; mode: "review" | "signing" | "archive" }) {
  const query = useMeeting(meetingId);
  const saveDraft = useSaveMeetingDraft();
  const [tab, setTab] = useState<MeetingReviewTab>("Minutes");
  const [editingTab, setEditingTab] = useState<EditableMeetingTab | null>(null);
  const [motionAttentionIndexes, setMotionAttentionIndexes] = useState<number[]>([]);
  const [motionEditTarget, setMotionEditTarget] = useState<number | null>(null);
  const heading = (
    <div>
      <div className="text-xs font-semibold tracking-wide text-secondary">
        <Link href="/app/meetings" className="hover:underline">Meeting records</Link> · <span className="capitalize">{mode}</span>
      </div>
      <h1 className="mt-0.5 text-2xl font-semibold">Meeting record</h1>
    </div>
  );

  if (query.isLoading) return <LoadingState label="Loading meeting" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} /></div>;

  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<ErrorState message="Meeting details were not returned." retry={() => void query.refetch()} retrying={query.isFetching} /></div>;

  const save = (draft: MeetingReviewDraft) => saveDraft.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version, draft },
    {
      onSuccess: () => {
        setEditingTab(null);
        setMotionAttentionIndexes([]);
        setMotionEditTarget(null);
        notify("Meeting changes saved.", "success");
      },
      onError: (error) => {
        if (error instanceof ApiClientError && error.code === "version_conflict") setEditingTab(null);
        notify(meetingMutationErrorMessage(error), "error");
      },
    },
  );
  const editing = editingTab !== null;
  const cancelEditing = () => {
    setEditingTab(null);
    setMotionEditTarget(null);
  };

  return (
    <div className="grid gap-4">
      {heading}
      <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm shadow-primary/5">
        <header className="grid gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <StatusBadge status={meeting.status} />
            <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
            <p className="text-sm text-muted-foreground">{meeting.category} · {meeting.meetingDate} · {meeting.durationMinutes ? `${meeting.durationMinutes} minutes · ` : ""}version {meeting.version}</p>
            {meeting.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Meeting tags">
                {meeting.tags.map((tag) => <Badge variant="outline" key={tag}>{tag}</Badge>)}
              </div>
            )}
          </div>
          <MeetingPdfPreview meeting={meeting} />
        </header>
        <MeetingAnalysisState meeting={meeting} />
        <TreasurerRejectionNotice meeting={meeting} />
        <MeetingWorkflowState meeting={meeting} onFeedback={notify} />
        <MeetingSourcePanel source={meeting.source} sourceParticipants={meeting.sourceParticipants} />
        <Tabs value={tab} onValueChange={(value) => setTab(value as MeetingReviewTab)}>
          <TabsList variant="line" className="mx-4 mt-2 justify-start overflow-x-auto overflow-y-hidden">
            {TABS.map((item) => (
              <TabsTrigger key={item} value={item} disabled={editing && editingTab !== item}>
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
          {TABS.map((item) => (
            <TabsContent key={item} value={item} className="p-4">
              {editingTab === item ? (
                item === "Minutes" ? (
                  <MeetingMinutesEditor
                    key={`${meeting.version}-minutes`}
                    meeting={meeting}
                    save={save}
                    cancel={cancelEditing}
                    busy={saveDraft.isPending}
                  />
                ) : item === "Attendance" ? (
                  <MeetingAttendanceEditor
                    key={`${meeting.version}-attendance`}
                    meeting={meeting}
                    save={save}
                    cancel={cancelEditing}
                    busy={saveDraft.isPending}
                  />
                ) : (
                  <MeetingMotionsEditor
                    key={`${meeting.version}-motions`}
                    meeting={meeting}
                    save={save}
                    cancel={cancelEditing}
                    busy={saveDraft.isPending}
                    highlightedMotionIndexes={motionAttentionIndexes}
                    focusMotionIndex={motionEditTarget ?? undefined}
                  />
                )
              ) : (
                <>
                  {meeting.capabilities.canEdit && isEditableTab(item) && (
                    <div className="mb-3 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="!font-bold"
                        onClick={() => {
                          setMotionEditTarget(item === "Motions" ? motionAttentionIndexes[0] ?? null : null);
                          setEditingTab(item);
                        }}
                      >
                        Edit {item.toLowerCase()}
                      </Button>
                    </div>
                  )}
                  {item === "History"
                    ? <ReviewHistoryTimeline history={meeting.history} />
                    : <MeetingTabs
                      meeting={meeting}
                      tab={item as MeetingTab}
                      motionIssues={meetingApprovalMotionIssues(meeting)}
                      highlightedMotionIndexes={motionAttentionIndexes}
                      onEditMotion={(motionIndex) => {
                        setMotionAttentionIndexes((current) => current.includes(motionIndex) ? current : [...current, motionIndex]);
                        setMotionEditTarget(motionIndex);
                        setEditingTab("Motions");
                      }}
                    />}
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <MeetingReviewActions
          meeting={meeting}
          editing={editing}
          onGoToMotions={(motionIndexes) => {
            setMotionEditTarget(null);
            setMotionAttentionIndexes(motionIndexes);
            setTab("Motions");
          }}
          onFeedback={notify}
        />
        <footer className="border-t border-border p-4 text-xs text-muted-foreground">
          Source transcripts are read-only. Last updated {formatAt(meeting.updatedAt)}.
        </footer>
      </article>
    </div>
  );
}

function isEditableTab(tab: MeetingReviewTab): tab is EditableMeetingTab {
  return tab === "Minutes" || tab === "Attendance" || tab === "Motions";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Meeting details could not be loaded.";
}

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
