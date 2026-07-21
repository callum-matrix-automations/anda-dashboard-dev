"use client";

import { useState } from "react";
import {
  useApproveMeeting,
  useDeferMeeting,
  useMarkMeetingReady,
  useResumeMeeting,
} from "@/frontend/hooks/useApi";
import { useModalDialog } from "@/frontend/components/shared/useModalDialog";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import { meetingApprovalReadinessIssues } from "@/frontend/presentation/meetingApprovalReadiness";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

interface MeetingReviewActionsProps {
  meeting: MeetingApiDetail;
  editing: boolean;
  onEdit: () => void;
  onFeedback: (message: string, tone: "error" | "success") => void;
}

export function MeetingReviewActions({ meeting, editing, onEdit, onFeedback }: MeetingReviewActionsProps) {
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
  const hasReviewAction = meeting.capabilities.canEdit
    || meeting.capabilities.canDefer
    || meeting.capabilities.canResume
    || meeting.capabilities.canMarkReady
    || meeting.capabilities.canApprove;
  if (!hasReviewAction) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2 border-t border-base-300 p-4">
        {meeting.capabilities.canEdit && <button type="button" className="btn btn-outline btn-sm" disabled={anyPending} onClick={onEdit}>Edit draft</button>}
        {meeting.capabilities.canDefer && <button type="button" className="btn btn-outline btn-sm" disabled={anyPending} onClick={() => setDialog("defer")}>Defer review</button>}
        {meeting.capabilities.canResume && <button type="button" className="btn btn-outline btn-sm" disabled={anyPending} onClick={runResume}>{resume.isPending ? "Resuming..." : "Resume review"}</button>}
        {meeting.capabilities.canMarkReady && (
          <button type="button" className="btn btn-primary btn-sm" disabled={anyPending || !meeting.minutes} onClick={runMarkReady}>
            {markReady.isPending ? "Updating..." : "Mark ready"}
          </button>
        )}
        {meeting.capabilities.canApprove && <button type="button" className="btn btn-primary btn-sm" disabled={anyPending} onClick={() => setDialog("approve")}>Approve minutes</button>}
      </div>
      {dialog === "defer" && <DeferDialog meeting={meeting} dismiss={() => setDialog(null)} onFeedback={onFeedback} />}
      {dialog === "approve" && <ApproveDialog meeting={meeting} dismiss={() => setDialog(null)} onFeedback={onFeedback} />}
    </>
  );
}

function DeferDialog({ meeting, dismiss, onFeedback }: DialogProps) {
  const dialogRef = useModalDialog(dismiss);
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
    <dialog ref={dialogRef} className="modal" aria-labelledby="defer-title">
      <div className="modal-box">
        <h2 id="defer-title" className="text-lg font-semibold">Defer this review?</h2>
        <p className="mt-2 text-sm opacity-70">The record stays editable but leaves the active review queue until it is resumed.</p>
        <textarea className="textarea textarea-bordered mt-4 w-full" aria-label="Deferral reason" maxLength={2_000} placeholder="Reason for deferral" value={note} onChange={(event) => setNote(event.target.value)} />
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" disabled={defer.isPending} onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={defer.isPending} onClick={submit}>{defer.isPending ? "Deferring..." : "Defer review"}</button>
        </div>
      </div>
    </dialog>
  );
}

function ApproveDialog({ meeting, dismiss, onFeedback }: DialogProps) {
  const dialogRef = useModalDialog(dismiss);
  const approve = useApproveMeeting();
  const unresolvedVoteCount = meeting.motions.reduce(
    (total, motion) => total + motion.votes.filter((vote) => vote.selection === "unresolved").length,
    0,
  );
  const readinessIssues = meetingApprovalReadinessIssues(meeting);
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
    <dialog ref={dialogRef} className="modal" aria-labelledby="approve-title">
      <div className="modal-box">
        <h2 id="approve-title" className="text-lg font-semibold">Approve these minutes?</h2>
        <p className="mt-2 text-sm opacity-70">Approval locks this version and starts PDF generation for Treasurer signing.</p>
        {readinessIssues.length > 0 && (
          <div role="alert" className="alert alert-error mt-4 items-start">
            <div>
              <strong>This meeting is not ready for approval.</strong>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {readinessIssues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
              <p className="mt-2 text-sm">Close this dialog and edit the draft to correct these items.</p>
            </div>
          </div>
        )}
        {unresolvedVoteCount > 0 && (
          <label className="mt-4 flex items-start gap-3 rounded-box border border-warning p-3">
            <input type="checkbox" className="checkbox checkbox-warning mt-0.5" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span className="text-sm">I acknowledge that {unresolvedVoteCount} {unresolvedVoteCount === 1 ? "vote is" : "votes are"} unresolved.</span>
          </label>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" disabled={approve.isPending} onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={approve.isPending || readinessIssues.length > 0} onClick={submit}>{approve.isPending ? "Approving..." : "Approve minutes"}</button>
        </div>
      </div>
    </dialog>
  );
}

interface DialogProps {
  meeting: MeetingApiDetail;
  dismiss: () => void;
  onFeedback: (message: string, tone: "error" | "success") => void;
}
