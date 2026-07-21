"use client";

import { useEffect, useState } from "react";
import { apiClient, ApiClientError } from "@/frontend/api-client/client";
import { useModalDialog } from "@/frontend/components/shared/useModalDialog";
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
    <aside className="overflow-hidden rounded-box border border-base-300 bg-base-200/40" aria-label="Approved PDF preview">
      <div className="flex items-center justify-between gap-3 border-b border-base-300 px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Approved PDF</p>
          <p className="text-xs opacity-60">Version {meeting.pdfArtifact.documentVersion}</p>
        </div>
        {previewUrl && <a className="link text-xs" href={previewUrl} target="_blank" rel="noreferrer">Open PDF</a>}
      </div>
      <div className="relative h-44 bg-base-300/40">
        {previewUrl ? (
          <>
            <iframe className="h-full w-full bg-white" src={`${previewUrl}#page=1&view=FitH&toolbar=0&navpanes=0`} title="Approved meeting minutes PDF" />
            <button
              type="button"
              className="absolute inset-0 flex items-end justify-end bg-transparent p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
              aria-label="Expand PDF preview"
              onClick={() => setExpanded(true)}
            >
              <span className="rounded bg-base-100/95 px-2 py-1 text-xs font-medium shadow-sm">Expand</span>
            </button>
          </>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-sm text-error">{error}</p>
            <button className="btn btn-ghost btn-xs" type="button" onClick={() => window.location.reload()}>Reload page</button>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm opacity-60" role="status">
            <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            Loading PDF preview
          </div>
        )}
      </div>
      {expanded && previewUrl && (
        <PdfPreviewDialog previewUrl={previewUrl} documentVersion={meeting.pdfArtifact.documentVersion} close={() => setExpanded(false)} />
      )}
    </aside>
  );
}

function PdfPreviewDialog({ previewUrl, documentVersion, close }: {
  previewUrl: string;
  documentVersion: number;
  close: () => void;
}) {
  const dialogRef = useModalDialog(close);
  return (
    <dialog ref={dialogRef} className="modal p-0" aria-labelledby="pdf-preview-title">
      <div className="modal-box flex h-[94vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0">
        <header className="flex items-center justify-between gap-4 border-b border-base-300 px-4 py-3">
          <div>
            <h2 id="pdf-preview-title" className="font-semibold">Approved meeting minutes</h2>
            <p className="text-xs opacity-60">Document version {documentVersion}</p>
          </div>
          <div className="flex items-center gap-2">
            <a className="btn btn-ghost btn-sm" href={previewUrl} target="_blank" rel="noreferrer">Open PDF</a>
            <button className="btn btn-sm" type="button" aria-label="Close PDF preview" onClick={close}>Close</button>
          </div>
        </header>
        <iframe className="min-h-0 flex-1 bg-white" src={`${previewUrl}#page=1&view=FitH`} title="Full-screen approved meeting minutes PDF" />
      </div>
      <form method="dialog" className="modal-backdrop"><button type="button" aria-label="Close PDF preview backdrop" onClick={close}>Close</button></form>
    </dialog>
  );
}
