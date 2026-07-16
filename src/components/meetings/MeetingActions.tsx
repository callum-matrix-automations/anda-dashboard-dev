"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { canDeferMeeting, canEditMeeting, canPerform, canResumeMeeting, canReviewMeetings } from "@/domain/permissions";
import { countUnresolvedVotes, isApprovalTransitionAllowed, retryActionFor, type MeetingAction as LifecycleAction } from "@/domain/stateMachine";
import { isDraftComplete } from "@/domain/manualDraft";
import type { Meeting } from "@/domain/types";
import { ConflictError } from "@/repositories/ports";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Toast } from "@/components/shared/Toast";
import { useModalDialog } from "@/components/shared/useModalDialog";
import { ManualDraftWizard } from "./ManualDraftWizard";
import { SigningWizard } from "./SigningWizard";

const successCopy: Partial<Record<LifecycleAction, string>> = {
  APPROVE: "Demo status changed to PDF processing. No PDF was generated.",
  SIGN: "Demo signature state recorded locally.",
  REJECT: "Demo record returned for changes locally.",
  AI_RETRY: "Demo status changed to analysis processing. No analysis service was called.",
  AI_MARK_MANUAL_READY: "Demo record marked ready for review locally.",
  PDF_RETRY: "Demo status changed to PDF processing. No PDF service was called.",
  SIGN_RETRY: "Demo status changed to awaiting signature. No delivery was sent.",
};

// Report Issue never changes lifecycle state, and it does not exist for
// ARCHIVE_FAILED because the target workflow owns archive recovery.
const REPORTABLE_FAILURES: readonly Meeting["status"][] = ["AI_FAILED", "PDF_FAILED", "ESIGN_FAILED"];

interface ActionDialogProps {
  kind: "approve" | "defer";
  unresolved: number;
  note: string;
  busy: boolean;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

function ActionDialog({ kind, unresolved, note, busy, onNoteChange, onCancel, onConfirm }: ActionDialogProps) {
  const dismiss = () => { if (!busy) onCancel(); };
  const dialogRef = useModalDialog(dismiss);
  return (
    <dialog ref={dialogRef} className="modal" aria-label={`${kind} meeting`}>
      <div className="modal-box">
        <h2 className="text-lg font-semibold">{kind === "approve" ? "Approve and lock minutes?" : "Defer meeting"}</h2>
        {kind === "approve" && (
          <>
            <div role="alert" className="alert alert-warning mt-3">
              <span>Approval locks this version from PDF processing onward. Minutes, attendance, motions, and votes cannot change. A Treasurer Return for changes is the only path that reopens editing.</span>
            </div>
            {unresolved > 0 && <p className="mt-3 font-medium">{unresolved} unresolved {unresolved === 1 ? "vote" : "votes"} will remain in the approved record and do not block approval.</p>}
          </>
        )}
        {kind === "defer" && (
          <textarea className="textarea textarea-bordered mt-3 w-full" aria-label="Optional deferral note" placeholder="Optional note" value={note} disabled={busy} onChange={(event) => onNoteChange(event.target.value)} />
        )}
        <div className="modal-action grid grid-cols-2 gap-2 pb-[max(0rem,env(safe-area-inset-bottom))]">
          <button className="btn btn-ghost min-h-11" onClick={dismiss} disabled={busy}>Cancel</button>
          <button className="btn btn-primary min-h-11" disabled={busy} onClick={onConfirm}>{kind === "approve" ? "Confirm" : "Defer"}</button>
        </div>
      </div>
    </dialog>
  );
}

interface OperatorAction {
  key: string;
  label: string;
  tone: "primary" | "outline" | "error" | "warning" | "ghost";
  run: () => void;
}

export function MeetingActions({ meeting, update, startEdit }: { meeting: Meeting; update: (next: Meeting) => void; startEdit: () => void }) {
  const meetingRef = useRef(meeting);
  const mutationLockRef = useRef(false);
  meetingRef.current = meeting;
  const { repositories, viewer, setFlash } = useWorkspace();
  const router = useRouter();
  const client = useQueryClient();
  const [modal, setModal] = useState<"approve" | "defer" | null>(null);
  const [wizard, setWizard] = useState<"manual" | "sign" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);
  const [conflict, setConflict] = useState(false);

  // AIDEV-NOTE: Update the queue cache synchronously before routing so metadata moves are atomic in the UI.
  const finish = (next: Meeting, text: string, path?: string) => {
    update(next);
    client.setQueryData<Meeting>(["meeting", next.id], next);
    client.setQueryData<Meeting[]>(["meetings"], (old) => old?.map((item) => (item.id === next.id ? next : item)));
    setModal(null);
    setWizard(null);
    setConflict(false);
    setToast({ text, tone: "success" });
    void client.invalidateQueries({ queryKey: ["meetings"] });
    if (path) router.push(path);
  };

  const fail = async (reason: unknown) => {
    if (reason instanceof ConflictError) {
      setConflict(true);
      setToast({ text: "The local demo record was refreshed. Review the latest state and retry.", tone: "error" });
      await client.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      const fresh = client.getQueryData<Meeting>(["meeting", meeting.id]);
      if (fresh) {
        meetingRef.current = fresh;
        update(fresh);
      }
    } else setToast({ text: reason instanceof Error ? reason.message : "Action failed.", tone: "error" });
  };

  const action = useMutation({
    mutationFn: ({ kind, comment }: { kind: LifecycleAction; comment?: string }) =>
      repositories.meetings.applyAction(meetingRef.current.id, kind, { expectedVersion: meetingRef.current.version, comment, actorName: viewer.name }),
    onSuccess: (next, input) => {
      mutationLockRef.current = false;
      // Signing completion returns to the queue with a persistent message; the item
      // leaves the queue because its status moved to COMPLETED / PENDING_APPROVAL.
      if (input.kind === "SIGN") setFlash(`Demo signature and archive state recorded locally for “${next.title}”. No signature or PDF file was created.`);
      if (input.kind === "REJECT") setFlash(`Demo return recorded locally for “${next.title}”. Officers will see the comment as the rejection reason.`);
      finish(
        next,
        successCopy[input.kind] ?? "Action completed.",
        input.kind === "APPROVE" ? "/app/needs-review" : input.kind === "SIGN" ? "/app/signing" : input.kind === "REJECT" ? "/app/needs-review" : undefined,
      );
    },
    onError: async (reason) => {
      try {
        await fail(reason);
      } finally {
        mutationLockRef.current = false;
      }
    },
  });

  const deferral = useMutation({
    mutationFn: (kind: "defer" | "resume") =>
      kind === "defer"
        ? repositories.meetings.defer(meetingRef.current.id, note || undefined, { expectedVersion: meetingRef.current.version, actorName: viewer.name })
        : repositories.meetings.resume(meetingRef.current.id, { expectedVersion: meetingRef.current.version, actorName: viewer.name }),
    onSuccess: (next, kind) => {
      mutationLockRef.current = false;
      finish(
        next,
        kind === "defer" ? "Demo meeting deferred in local state only." : "Demo meeting returned to review in local state only.",
        kind === "defer" ? "/app/deferred" : "/app/needs-review",
      );
    },
    onError: async (reason) => {
      try {
        await fail(reason);
      } finally {
        mutationLockRef.current = false;
      }
    },
  });

  // AIDEV-NOTE: The ref closes the event-to-render gap so rapid taps cannot enqueue competing lifecycle writes.
  const runLifecycle = (input: { kind: LifecycleAction; comment?: string }) => {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true;
    setConflict(false);
    action.mutate(input);
  };
  const runDeferral = (kind: "defer" | "resume") => {
    if (mutationLockRef.current) return;
    mutationLockRef.current = true;
    setConflict(false);
    deferral.mutate(kind);
  };

  const retry = retryActionFor(meeting.status);
  const unresolved = countUnresolvedVotes(meeting);
  if (meeting.status === "COMPLETED") return null;

  const actions: OperatorAction[] = [];
  if (canEditMeeting(viewer, meeting) && !meeting.deferredAt) actions.push({ key: "edit", label: "Edit minutes", tone: "outline", run: startEdit });
  if (meeting.status === "AI_FAILED" && canPerform(viewer, meeting, "AI_RETRY")) actions.push({ key: "analysis-retry", label: "Retry Analysis", tone: "warning", run: () => runLifecycle({ kind: "AI_RETRY" }) });
  if (meeting.status === "AI_FAILED" && canEditMeeting(viewer, meeting) && !meeting.deferredAt) actions.push({ key: "manual", label: "Complete Manually", tone: "primary", run: () => setWizard("manual") });
  // Mark Ready is offered only after the draft meets the same completeness rule as the manual wizard.
  if (canPerform(viewer, meeting, "AI_MARK_MANUAL_READY") && isDraftComplete(meeting)) actions.push({ key: "ready", label: "Mark Ready for Review", tone: "outline", run: () => runLifecycle({ kind: "AI_MARK_MANUAL_READY" }) });
  if (retry && meeting.status !== "AI_FAILED" && canPerform(viewer, meeting, retry)) actions.push({ key: "retry", label: meeting.status === "ESIGN_FAILED" ? "Retry delivery" : "Retry", tone: "warning", run: () => runLifecycle({ kind: retry }) });
  if (canDeferMeeting(viewer, meeting)) actions.push({ key: "defer", label: "Defer", tone: "outline", run: () => setModal("defer") });
  if (canResumeMeeting(viewer, meeting)) actions.push({ key: "resume", label: "Resume Review", tone: "primary", run: () => runDeferral("resume") });
  if (canPerform(viewer, meeting, "APPROVE") && isApprovalTransitionAllowed(meeting)) actions.push({ key: "approve", label: "Approve", tone: "primary", run: () => setModal("approve") });
  if (canPerform(viewer, meeting, "SIGN")) actions.push({ key: "sign", label: "Sign", tone: "primary", run: () => setWizard("sign") });
  if (canPerform(viewer, meeting, "REJECT")) actions.push({ key: "reject", label: "Return for changes", tone: "error", run: () => setWizard("reject") });
  if (REPORTABLE_FAILURES.includes(meeting.status) && canReviewMeetings(viewer)) actions.push({ key: "report", label: "Report Issue", tone: "outline", run: () => setToast({ text: "Demo feedback only: no report was sent and meeting state did not change.", tone: "success" }) });

  const preferredKey = meeting.deferredAt ? "resume" : meeting.status === "AI_FAILED" ? "manual" : meeting.status === "PENDING_APPROVAL" ? "approve" : meeting.status === "PDF_FAILED" || meeting.status === "ESIGN_FAILED" ? "retry" : meeting.status === "AWAITING_SIGNATURE" ? "sign" : actions[0]?.key;
  const primary = actions.find(({ key }) => key === preferredKey) ?? actions[0];
  const secondary = actions.filter(({ key }) => key !== primary?.key);
  const toneClass: Record<OperatorAction["tone"], string> = { primary: "btn-primary", outline: "btn-outline", error: "btn-error", warning: "btn-warning", ghost: "btn-ghost" };
  const operationPending = action.isPending || deferral.isPending;

  return (
    <>
      <div className="sticky bottom-0 z-20 grid grid-cols-1 gap-2 border-t border-base-300 bg-base-100/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:flex sm:flex-wrap">
        {primary && <button className={`btn min-h-11 w-full sm:w-auto ${toneClass[primary.tone]}`} disabled={operationPending} onClick={primary.run}>{primary.label}</button>}
        {secondary.length > 0 && (
          <details className={`dropdown dropdown-top sm:dropdown-end ${operationPending ? "pointer-events-none opacity-50" : ""}`}>
            <summary className="btn btn-outline min-h-11 w-full sm:w-auto" aria-disabled={operationPending} onClick={(event) => { if (operationPending) event.preventDefault(); }}>More actions</summary>
            <ul className="dropdown-content menu z-30 mb-2 w-full min-w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow-xl sm:w-64">
              {secondary.map((item) => (
                <li key={item.key}><button className={`btn min-h-11 w-full justify-start ${toneClass[item.tone]}`} disabled={operationPending} onClick={item.run}>{item.label}</button></li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {modal && (
        <ActionDialog
          kind={modal}
          unresolved={unresolved}
          note={note}
          busy={operationPending}
          onNoteChange={setNote}
          onCancel={() => setModal(null)}
          onConfirm={() => (modal === "approve" ? runLifecycle({ kind: "APPROVE" }) : runDeferral("defer"))}
        />
      )}
      {wizard === "manual" && (
        <ManualDraftWizard
          meeting={meeting}
          onFinished={(next) => finish(next, "Demo meeting marked ready for review in local state only.")}
          onCancel={() => setWizard(null)}
        />
      )}
      {(wizard === "sign" || wizard === "reject") && (
        <SigningWizard
          meeting={meeting}
          intent={wizard}
          busy={operationPending}
          onSign={() => runLifecycle({ kind: "SIGN" })}
          onReject={(comment) => runLifecycle({ kind: "REJECT", comment })}
          onCancel={() => setWizard(null)}
        />
      )}
      {conflict && (
        <div className="toast toast-start z-50">
          <div className="alert alert-error">
            <span>The local demo record was refreshed. Review the latest state and retry.</span>
            <button className="btn btn-sm" onClick={() => setConflict(false)}>Dismiss</button>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.text} tone={toast.tone} clear={() => setToast(null)} />}
    </>
  );
}
