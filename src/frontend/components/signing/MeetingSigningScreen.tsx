"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError } from "@/frontend/api-client/client";
import {
  useMeeting,
  useMeetingSigningSession,
  useRejectMeetingSigning,
} from "@/frontend/hooks/useApi";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { Toast } from "@/frontend/components/shared/Toast";
import { useModalDialog } from "@/frontend/components/shared/useModalDialog";
import { MeetingPdfPreview } from "@/frontend/components/meetings/MeetingPdfPreview";
import { MeetingWorkflowState } from "@/frontend/components/meetings/MeetingWorkflowState";
import { statusLabel, statusText } from "@/frontend/components/shared/meetingPresentation";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { EmbeddedFirmaSigning } from "./EmbeddedFirmaSigning";

type Feedback = { message: string; tone: "error" | "success" };

export function MeetingSigningScreen({ meetingId }: { meetingId: string }) {
  const query = useMeeting(meetingId);
  const [signingRequested, setSigningRequested] = useState(false);
  const session = useMeetingSigningSession(
    meetingId,
    query.data?.pdfArtifact?.documentVersion ?? null,
    signingRequested,
  );
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [providerState, setProviderState] = useState<string | null>(null);
  const heading = (
    <div>
      <div className="breadcrumbs text-xs"><ul><li><Link href="/app/signing">Signing</Link></li><li>Meeting</li></ul></div>
      <h1 className="text-2xl font-semibold">Treasurer signing</h1>
      <p className="text-sm opacity-60">Review the locked document, sign it in Firma, or return it to the Officer with a comment.</p>
    </div>
  );

  if (query.isLoading) return <LoadingState label="Loading Treasurer signing record" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} /></div>;
  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<ErrorState message="The signing record was not returned." retry={() => void query.refetch()} /></div>;

  const showFeedback = (message: string, tone: Feedback["tone"]) => setFeedback({ message, tone });
  const submitted = () => {
    setProviderState("Firma has accepted the signature. Waiting for the verified callback and signed PDF.");
    void query.refetch();
  };

  if (meeting.status === "COMPLETED") {
    return (
      <div className="grid gap-4">
        {heading}
        <div role="status" className="alert alert-success">
          <div><strong>Signing and archival are complete.</strong><p className="text-sm">The immutable signed record is now available in the archive.</p></div>
          <Link className="btn btn-sm" href={`/app/archive/${meeting.id}`}>View signed record</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {heading}
      {feedback && <Toast message={feedback.message} tone={feedback.tone} clear={() => setFeedback(null)} />}
      <article className="card overflow-hidden border border-base-300 bg-base-100">
        <header className="grid gap-4 border-b border-base-300 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
            <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
            <p className="text-sm opacity-60">{meeting.category} · {meeting.meetingDate} · document version {meeting.pdfArtifact?.documentVersion ?? "pending"}</p>
            {meeting.approval && <p className="mt-3 text-sm">Approved by {meeting.approval.approvedByDisplayName} on {formatAt(meeting.approval.approvedAt)}.</p>}
            <p className="mt-2 text-xs opacity-60">The approved content is locked. Open the full meeting record if transcript evidence is needed.</p>
            <Link className="link mt-2 inline-block text-sm" href={`/app/meetings/${meeting.id}`}>Open full meeting record</Link>
          </div>
          <MeetingPdfPreview meeting={meeting} />
        </header>
        <MeetingWorkflowState meeting={meeting} onFeedback={showFeedback} />
        <div className="flex flex-wrap justify-end gap-2 p-4">
          {meeting.capabilities.canRejectSigning && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRejecting(true)}>Return for corrections</button>
          )}
          {meeting.capabilities.canOpenSigningSession && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setSigningRequested(true)}>
              {signingRequested ? "Signing session opened" : "Sign document"}
            </button>
          )}
        </div>
      </article>

      {providerState && <div role="status" className="alert alert-info"><span>{providerState}</span></div>}
      {signingRequested && session.isLoading && <LoadingState label="Opening secure Firma signing session" />}
      {signingRequested && session.isError && (
        <ErrorState message={errorMessage(session.error)} retry={() => void session.refetch()} />
      )}
      {session.data && (
        <EmbeddedFirmaSigning
          signingUrl={session.data.signingUrl}
          onStarted={() => setProviderState("Firma signing is in progress.")}
          onCompleted={submitted}
          onDeclined={() => setProviderState("Firma reports that the signing session was declined. ANDA will wait for the verified provider outcome.")}
          onError={(message) => showFeedback(message, "error")}
        />
      )}
      {rejecting && <RejectSigningDialog meeting={meeting} dismiss={() => setRejecting(false)} onFeedback={showFeedback} />}
    </div>
  );
}

function RejectSigningDialog({ meeting, dismiss, onFeedback }: {
  meeting: MeetingApiDetail;
  dismiss: () => void;
  onFeedback: (message: string, tone: Feedback["tone"]) => void;
}) {
  const dialogRef = useModalDialog(dismiss);
  const reject = useRejectMeetingSigning();
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    const preparedComment = comment.trim();
    if (!preparedComment) {
      setError("Explain what must be corrected before returning this meeting.");
      return;
    }
    reject.mutate(
      { meetingId: meeting.id, expectedVersion: meeting.version, comment: preparedComment },
      {
        onSuccess: () => {
          dismiss();
          onFeedback("Meeting returned to the Officer for corrections.", "success");
          router.push(`/app/meetings/${meeting.id}`);
        },
        onError: (mutationError) => setError(meetingMutationErrorMessage(mutationError)),
      },
    );
  };

  return (
    <dialog ref={dialogRef} className="modal" aria-labelledby="reject-signing-title">
      <div className="modal-box">
        <h2 id="reject-signing-title" className="text-lg font-semibold">Return this meeting for corrections?</h2>
        <p className="mt-2 text-sm opacity-70">The current Firma request will be cancelled, the meeting will return to Needs Review, and the Officer will need to approve a new document version.</p>
        <label className="form-control mt-4">
          <span className="label-text mb-1 text-xs">Required correction comment</span>
          <textarea className="textarea textarea-bordered min-h-28 w-full" maxLength={2_000} value={comment} onChange={(event) => { setComment(event.target.value); setError(""); }} placeholder="Describe exactly what needs to change" />
        </label>
        {error && <p role="alert" className="mt-2 text-sm text-error">{error}</p>}
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" disabled={reject.isPending} onClick={dismiss}>Cancel</button>
          <button type="button" className="btn btn-warning" disabled={reject.isPending} onClick={submit}>{reject.isPending ? "Returning..." : "Return for corrections"}</button>
        </div>
      </div>
    </dialog>
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ApiClientError) return error.message;
  return error instanceof Error ? error.message : "The signing workflow is unavailable.";
}

function formatAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
