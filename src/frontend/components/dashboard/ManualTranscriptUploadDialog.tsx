"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUploadTranscript } from "@/frontend/hooks/useApi";
import { UploadIcon } from "@/frontend/components/design-system/icons";
import { Button } from "@/frontend/components/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/frontend/components/design-system/primitives/dialog";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";

export function ManualTranscriptUploadDialog() {
  const router = useRouter();
  const upload = useUploadTranscript();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(todayForInput);
  const [duration, setDuration] = useState("60");
  const [transcript, setTranscript] = useState("");
  const [validationError, setValidationError] = useState("");
  const [failedMeetingId, setFailedMeetingId] = useState<string | null>(null);

  const changeOpen = (next: boolean) => {
    if (upload.isPending) return;
    setOpen(next);
    if (next) {
      upload.reset();
      setValidationError("");
      setFailedMeetingId(null);
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const durationMinutes = Number(duration);
    if (!title.trim()) {
      setValidationError("Enter a meeting title.");
      return;
    }
    if (!meetingDate) {
      setValidationError("Choose a meeting date.");
      return;
    }
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440) {
      setValidationError("Duration must be a whole number between 1 and 1,440 minutes.");
      return;
    }
    if (!transcript.trim()) {
      setValidationError("Paste a transcript before beginning processing.");
      return;
    }

    setValidationError("");
    setFailedMeetingId(null);
    upload.mutate({
      title: title.trim(),
      meetingDate,
      durationMinutes,
      transcript,
    }, {
      onSuccess: (result) => {
        if (result.status === "ai_failed") {
          setFailedMeetingId(result.meetingId);
          return;
        }
        setOpen(false);
        router.push(`/app/meetings/${result.meetingId}`);
      },
    });
  };

  const processingError = validationError
    || (upload.isError ? errorMessage(upload.error) : "")
    || (failedMeetingId
      ? "The transcript was saved, but AI analysis did not complete after three attempts."
      : "");

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button size="lg" />}>
        <UploadIcon aria-hidden />
        Upload transcript
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" showCloseButton={!upload.isPending}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Upload transcript</DialogTitle>
          <DialogDescription>
            Paste a plain-text transcript. Put each speaker turn on a new line as
            {" “Name: dialogue”"} so exact member names can be linked to their profiles.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <label htmlFor="manual-meeting-title" className="text-sm font-semibold">Meeting title</label>
            <Input
              id="manual-meeting-title"
              className="h-10"
              value={title}
              maxLength={500}
              disabled={upload.isPending}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. August board meeting"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="manual-meeting-date" className="text-sm font-semibold">Meeting date</label>
              <Input
                id="manual-meeting-date"
                className="h-10"
                type="date"
                value={meetingDate}
                disabled={upload.isPending}
                onChange={(event) => setMeetingDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="manual-meeting-duration" className="text-sm font-semibold">Duration in minutes</label>
              <Input
                id="manual-meeting-duration"
                className="h-10"
                type="number"
                min={1}
                max={1_440}
                step={1}
                value={duration}
                disabled={upload.isPending}
                onChange={(event) => setDuration(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="manual-transcript" className="text-sm font-semibold">Transcript</label>
            <Textarea
              id="manual-transcript"
              className="min-h-72 max-h-[48vh] resize-y font-mono text-sm"
              value={transcript}
              maxLength={1_000_000}
              disabled={upload.isPending}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder={"Chair: Welcome to the meeting.\nMember: I would like to raise the first agenda item."}
            />
            <span className="text-xs text-muted-foreground">
              {transcript.length.toLocaleString("en-GB")} characters
            </span>
          </div>

          {processingError && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {processingError}
            </div>
          )}

          {upload.isPending && (
            <p className="text-sm text-muted-foreground">
              The transcript is being stored and analysed with GPT-5.6 Terra. Keep this window open until processing finishes.
            </p>
          )}

          <DialogFooter>
            {failedMeetingId ? (
              <Button type="button" onClick={() => router.push(`/app/meetings/${failedMeetingId}`)}>
                Open failed meeting
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={upload.isPending} onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={upload.isPending}>
                  {upload.isPending ? "Processing transcript..." : "Begin processing"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function todayForInput() {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The transcript could not be processed.";
}
