"use client";

import { useEffect, useState } from "react";
import { apiClient, ApiClientError } from "@/frontend/api-client/client";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/frontend/components/design-system/primitives/dialog";
import { SpinnerIcon } from "@phosphor-icons/react";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export function MeetingPdfPreview({ meeting }: { meeting: MeetingApiDetail }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!meeting.pdfArtifact) return;
    let active = true;
    let objectUrl: string | null = null;

    setPreviewUrl(null);
    setError(null);
    void apiClient.meetings.previewPdf(meeting.id)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof ApiClientError
          ? caught.message
          : "The approved PDF preview could not be loaded.");
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meeting.id, meeting.pdfArtifact]);

  if (!meeting.pdfArtifact) return null;

  return (
    <aside className="overflow-hidden rounded-xl border border-border bg-muted/40" aria-label="Approved PDF preview">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approved PDF</p>
          <p className="text-xs text-muted-foreground">Version {meeting.pdfArtifact.documentVersion}</p>
        </div>
        {previewUrl && <a className="text-xs font-medium text-primary underline-offset-2 hover:underline" href={previewUrl} target="_blank" rel="noreferrer">Open PDF</a>}
      </div>
      <div className="relative h-44 bg-muted">
        {previewUrl ? (
          <>
            <iframe className="h-full w-full bg-white" src={`${previewUrl}#page=1&view=FitH&toolbar=0&navpanes=0`} title="Approved meeting minutes PDF" />
            <button
              type="button"
              className="absolute inset-0 flex items-end justify-end bg-transparent p-2 focus-visible:outline-2 focus-visible:-outline-offset-2"
              aria-label="Expand PDF preview"
              onClick={() => setExpanded(true)}
            >
              <span className="rounded bg-card/95 px-2 py-1 text-xs font-medium shadow-sm">Expand</span>
            </button>
          </>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="ghost" size="sm" type="button" onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <SpinnerIcon className="size-4 animate-spin" aria-hidden />
            Loading PDF preview
          </div>
        )}
      </div>
      <PdfPreviewDialog
        open={expanded && Boolean(previewUrl)}
        previewUrl={previewUrl ?? ""}
        documentVersion={meeting.pdfArtifact.documentVersion}
        close={() => setExpanded(false)}
      />
    </aside>
  );
}

function PdfPreviewDialog({ open, previewUrl, documentVersion, close }: {
  open: boolean;
  previewUrl: string;
  documentVersion: number;
  close: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[94vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        aria-labelledby="pdf-preview-title"
      >
        <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <DialogTitle id="pdf-preview-title">Approved meeting minutes</DialogTitle>
            <DialogDescription>Document version {documentVersion}</DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <a className={buttonVariants({ variant: "ghost", size: "sm" })} href={previewUrl} target="_blank" rel="noreferrer">Open PDF</a>
            <Button size="sm" type="button" aria-label="Close PDF preview" onClick={close}>Close</Button>
          </div>
        </DialogHeader>
        <iframe className="min-h-0 flex-1 bg-white" src={`${previewUrl}#page=1&view=FitH`} title="Full-screen approved meeting minutes PDF" />
      </DialogContent>
    </Dialog>
  );
}
