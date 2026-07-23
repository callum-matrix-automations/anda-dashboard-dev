"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApiClientError } from "@/frontend/api-client/client";
import {
  useMeeting,
  useMeetingSigningSession,
  useRejectMeetingSigning,
} from "@/frontend/hooks/useApi";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { StatusBadge } from "@/frontend/components/shared/StatusBadge";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/frontend/components/design-system/primitives/alert";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";
import { Label } from "@/frontend/components/design-system/primitives/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/frontend/components/design-system/primitives/dialog";
import { MeetingPdfPreview } from "@/frontend/components/meetings/MeetingPdfPreview";
import { MeetingWorkflowState } from "@/frontend/components/meetings/MeetingWorkflowState";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { EmbeddedFirmaSigning } from "./EmbeddedFirmaSigning";

type Feedback = { message: string; tone: "error" | "success" };

function notify(message: string, tone: Feedback["tone"]) {
  if (tone === "success") toast.success(message);
  else toast.error(message);
}

export function MeetingSigningScreen({ meetingId }: { meetingId: string }) {
  const query = useMeeting(meetingId);
  const [signingRequested, setSigningRequested] = useState(false);
  const session = useMeetingSigningSession(
    meetingId,
    query.data?.pdfArtifact?.documentVersion ?? null,
    signingRequested,
  );
  const [rejecting, setRejecting] = useState(false);
  const [providerState, setProviderState] = useState<string | null>(null);
  const heading = (
    <div>
      <div className="text-xs font-semibold tracking-wide text-secondary">
        <Link href="/app/signing" className="hover:underline">Signing</Link> · Meeting
      </div>
      <h1 className="mt-0.5 text-2xl font-semibold">Treasurer signing</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Review the locked document, sign it in Firma, or return it to the Officer with a comment.</p>
    </div>
  );

  if (query.isLoading) return <LoadingState label="Loading Treasurer signing record" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} /></div>;
  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<ErrorState message="The signing record was not returned." retry={() => void query.refetch()} retrying={query.isFetching} /></div>;

  const submitted = () => {
    setProviderState("Firma has accepted the signature. Waiting for the verified callback and signed PDF.");
    void query.refetch();
  };

  if (meeting.status === "COMPLETED") {
    return (
      <div className="grid gap-4">
        {heading}
        <Alert>
          <AlertTitle>Signing and archival are complete.</AlertTitle>
          <AlertDescription>The immutable signed record is now available in the archive.</AlertDescription>
          <AlertAction>
            <Link className={buttonVariants({ size: "sm" })} href={`/app/archive/${meeting.id}`}>View signed record</Link>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {heading}
      <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm shadow-primary/5">
        <header className="grid gap-4 border-b border-border p-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <StatusBadge status={meeting.status} />
            <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
            <p className="text-sm text-muted-foreground">{meeting.category} · {meeting.meetingDate} · document version {meeting.pdfArtifact?.documentVersion ?? "pending"}</p>
            {meeting.approval && <p className="mt-3 text-sm">Approved by {meeting.approval.approvedByDisplayName} on {formatAt(meeting.approval.approvedAt)}.</p>}
            <p className="mt-2 text-xs text-muted-foreground">The approved content is locked. Open the full meeting record if transcript evidence is needed.</p>
            <Link className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline" href={`/app/meetings/${meeting.id}`}>Open full meeting record</Link>
          </div>
          <MeetingPdfPreview meeting={meeting} />
        </header>
        <MeetingWorkflowState meeting={meeting} onFeedback={notify} />
        <div className="flex flex-wrap justify-end gap-2 p-4">
          {meeting.capabilities.canRejectSigning && (
            <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(true)}>Return for corrections</Button>
          )}
          {meeting.capabilities.canOpenSigningSession && (
            <Button
              type="button"
              size="sm"
              loading={signingRequested && session.isLoading}
              disabled={signingRequested && session.isLoading}
              onClick={() => setSigningRequested(true)}
            >
              {signingRequested ? "Signing session opened" : "Sign document"}
            </Button>
          )}
        </div>
      </article>

      {providerState && (
        <Alert>
          <AlertDescription>{providerState}</AlertDescription>
        </Alert>
      )}
      {signingRequested && session.isLoading && <LoadingState label="Opening secure Firma signing session" />}
      {signingRequested && session.isError && (
        <ErrorState message={errorMessage(session.error)} retry={() => void session.refetch()} retrying={session.isFetching} />
      )}
      {session.data && (
        <EmbeddedFirmaSigning
          signingUrl={session.data.signingUrl}
          onStarted={() => setProviderState("Firma signing is in progress.")}
          onCompleted={submitted}
          onDeclined={() => setProviderState("Firma reports that the signing session was declined. ANDA will wait for the verified provider outcome.")}
          onError={(message) => notify(message, "error")}
        />
      )}
      <RejectSigningDialog open={rejecting} meeting={meeting} dismiss={() => setRejecting(false)} />
    </div>
  );
}

function RejectSigningDialog({ open, meeting, dismiss }: {
  open: boolean;
  meeting: MeetingApiDetail;
  dismiss: () => void;
}) {
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
          notify("Meeting returned to the Officer for corrections.", "success");
          router.push(`/app/meetings/${meeting.id}`);
        },
        onError: (mutationError) => setError(meetingMutationErrorMessage(mutationError)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent aria-labelledby="reject-signing-title">
        <DialogHeader>
          <DialogTitle id="reject-signing-title">Return this meeting for corrections?</DialogTitle>
          <DialogDescription>The current Firma request will be cancelled, the meeting will return to Needs Review, and the Officer will need to approve a new document version.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="reject-signing-comment" className="text-xs">Required correction comment</Label>
          <Textarea
            id="reject-signing-comment"
            className="min-h-28"
            maxLength={2_000}
            value={comment}
            onChange={(event) => { setComment(event.target.value); setError(""); }}
            placeholder="Describe exactly what needs to change"
          />
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={reject.isPending} onClick={dismiss}>Cancel</Button>
          <Button type="button" variant="destructive" loading={reject.isPending} disabled={reject.isPending} onClick={submit}>{reject.isPending ? "Returning..." : "Return for corrections"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
