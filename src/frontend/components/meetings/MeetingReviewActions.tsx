"use client";

import { useState } from "react";
import {
  useApproveMeeting,
  useDeferMeeting,
  useMarkMeetingReady,
  useResumeMeeting,
} from "@/frontend/hooks/useApi";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import { meetingApprovalInvalidMotionIndexes, meetingApprovalReadinessIssues } from "@/frontend/presentation/meetingApprovalReadiness";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";
import { Checkbox } from "@/frontend/components/design-system/primitives/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/frontend/components/design-system/primitives/dialog";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

interface MeetingReviewActionsProps {
  meeting: MeetingApiDetail;
  editing: boolean;
  onGoToMotions?: (motionIndexes: number[]) => void;
  onFeedback: (message: string, tone: "error" | "success") => void;
}

export function MeetingReviewActions({ meeting, editing, onGoToMotions, onFeedback }: MeetingReviewActionsProps) {
  const [dialog, setDialog] = useState<"defer" | "approve" | null>(null);
  const resume = useResumeMeeting();
  const markReady = useMarkMeetingReady();
  const anyPending = resume.isPending || markReady.isPending;

  const runResume = () => resume.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version },
    {
      onSuccess: () => onFeedback("Meeting review resumed.", "success"),
      onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
    },
  );
  const runMarkReady = () => markReady.mutate(
    { meetingId: meeting.id, expectedVersion: meeting.version },
    {
      onSuccess: () => onFeedback("Manual draft marked ready for approval.", "success"),
      onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
    },
  );

  if (editing) return null;
  const hasReviewAction = meeting.capabilities.canDefer
    || meeting.capabilities.canResume
    || meeting.capabilities.canMarkReady
    || meeting.capabilities.canApprove;
  if (!hasReviewAction) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border p-4">
        {meeting.capabilities.canDefer && <Button type="button" size="sm" variant="outline" className="!font-bold" disabled={anyPending} onClick={() => setDialog("defer")}>Defer review</Button>}
        {meeting.capabilities.canResume && <Button type="button" size="sm" variant="outline" loading={resume.isPending} disabled={anyPending} onClick={runResume}>{resume.isPending ? "Resuming..." : "Resume review"}</Button>}
        {meeting.capabilities.canMarkReady && (
          <Button type="button" size="sm" className="!font-bold" loading={markReady.isPending} disabled={anyPending || !meeting.minutes} onClick={runMarkReady}>
            {markReady.isPending ? "Updating..." : "Mark ready"}
          </Button>
        )}
        {meeting.capabilities.canApprove && <Button type="button" size="sm" className="!font-bold" disabled={anyPending} onClick={() => setDialog("approve")}>Approve minutes</Button>}
      </div>
      <DeferDialog open={dialog === "defer"} meeting={meeting} dismiss={() => setDialog(null)} onFeedback={onFeedback} />
      <ApproveDialog open={dialog === "approve"} meeting={meeting} dismiss={() => setDialog(null)} onFeedback={onFeedback} onGoToMotions={onGoToMotions} />
    </>
  );
}

function DeferDialog({ open, meeting, dismiss, onFeedback }: DialogProps) {
  const defer = useDeferMeeting();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (!note.trim()) {
      setError("Add a reason before deferring this review.");
      return;
    }
    defer.mutate(
      { meetingId: meeting.id, expectedVersion: meeting.version, note: note.trim() },
      {
        onSuccess: () => { dismiss(); onFeedback("Meeting review deferred.", "success"); },
        onError: (mutationError) => setError(meetingMutationErrorMessage(mutationError)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent aria-labelledby="defer-title">
        <DialogHeader>
          <DialogTitle id="defer-title">Defer this review?</DialogTitle>
          <DialogDescription>The record stays editable but leaves the active review queue until it is resumed.</DialogDescription>
        </DialogHeader>
        <Textarea aria-label="Deferral reason" maxLength={2_000} placeholder="Reason for deferral" value={note} onChange={(event) => setNote(event.target.value)} />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={defer.isPending} onClick={dismiss}>Cancel</Button>
          <Button type="button" className="!font-bold" loading={defer.isPending} disabled={defer.isPending} onClick={submit}>{defer.isPending ? "Deferring..." : "Defer review"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApproveDialog({ open, meeting, dismiss, onFeedback, onGoToMotions }: DialogProps) {
  const approve = useApproveMeeting();
  const unresolvedVoteCount = meeting.motions.reduce(
    (total, motion) => total + motion.votes.filter((vote) => vote.selection === "unresolved").length,
    0,
  );
  const readinessIssues = meetingApprovalReadinessIssues(meeting);
  const invalidMotionIndexes = meetingApprovalInvalidMotionIndexes(meeting);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");

  const submit = () => {
    if (unresolvedVoteCount > 0 && !acknowledged) {
      setError("Acknowledge the unresolved votes before approval.");
      return;
    }
    approve.mutate(
      { meetingId: meeting.id, expectedVersion: meeting.version, acknowledgeUnresolvedVotes: acknowledged },
      {
        onSuccess: () => { dismiss(); onFeedback("Minutes approved. PDF generation has started.", "success"); },
        onError: (mutationError) => setError(meetingMutationErrorMessage(mutationError)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent aria-labelledby="approve-title">
        <DialogHeader>
          <DialogTitle id="approve-title">Approve these minutes?</DialogTitle>
          <DialogDescription>Approval locks this version and starts PDF generation for Treasurer signing.</DialogDescription>
        </DialogHeader>
        {readinessIssues.length > 0 && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <strong>This meeting is not ready for approval.</strong>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {readinessIssues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            <p className="mt-2">Close this dialog and edit the draft to correct these items.</p>
          </div>
        )}
        {unresolvedVoteCount > 0 && (
          <label className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/5 p-3">
            <Checkbox className="mt-0.5" checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} />
            <span className="text-sm">I acknowledge that {unresolvedVoteCount} {unresolvedVoteCount === 1 ? "vote is" : "votes are"} unresolved.</span>
          </label>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={approve.isPending} onClick={dismiss}>Cancel</Button>
          {invalidMotionIndexes.length > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={approve.isPending}
              onClick={() => {
                dismiss();
                onGoToMotions?.(invalidMotionIndexes);
              }}
            >
              Go to motions
            </Button>
          )}
          <Button type="button" className="!font-bold" loading={approve.isPending} disabled={approve.isPending || readinessIssues.length > 0} onClick={submit}>{approve.isPending ? "Approving..." : "Approve minutes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DialogProps {
  open: boolean;
  meeting: MeetingApiDetail;
  dismiss: () => void;
  onGoToMotions?: (motionIndexes: number[]) => void;
  onFeedback: (message: string, tone: "error" | "success") => void;
}
