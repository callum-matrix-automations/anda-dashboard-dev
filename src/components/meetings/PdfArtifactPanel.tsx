"use client";
import { useState } from "react";
import type { Meeting } from "@/domain/types";
import { artifactStateFor } from "@/domain/artifact";
import { Toast } from "@/components/shared/Toast";

type ArtifactMeeting = Pick<Meeting, "status" | "title" | "signedBy" | "signedAt" | "pdfArtifact">;

const ZOOM_LEVELS = [75, 100, 125, 150] as const;
type PreviewSize = "fit" | (typeof ZOOM_LEVELS)[number];

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// AIDEV-NOTE: Product-quality placeholder, not a fake binary. Every control gives
// honest demo feedback; nothing pretends a real PDF was rendered or transferred.
export function PdfArtifactPanel({ meeting }: { meeting: ArtifactMeeting }) {
  const state = artifactStateFor(meeting.status);
  const [previewSize, setPreviewSize] = useState<PreviewSize>("fit");
  const [toast, setToast] = useState("");
  if (state === "not_generated") return null;

  const artifact = meeting.pdfArtifact;
  const name = artifact?.name ?? `${meeting.title} — Minutes.pdf`;

  if (state === "processing") {
    return (
      <section aria-label="Document artifact" className="rounded-box border border-base-300 bg-base-200 p-4 text-sm">
        <p className="font-medium">
          <span className="loading loading-spinner loading-xs mr-2 align-middle" aria-hidden="true" />
          Demo lifecycle is at PDF processing.
        </p>
        <p className="mt-1 opacity-65">{name}{artifact ? ` · version ${artifact.version}` : ""}</p>
        <p className="mt-1 text-xs opacity-60">No PDF service is running. In the target workflow, the approved record would stay locked while the document is produced.</p>
      </section>
    );
  }

  if (state === "failed") {
    return (
      <section aria-label="Document artifact" className="rounded-box border border-base-300 bg-base-200 p-4 text-sm">
        <p role="alert" className="font-medium text-error">Demo lifecycle records a PDF failure.</p>
        <p className="mt-1 opacity-65">{name}{artifact ? ` · version ${artifact.version}` : ""}</p>
        <p className="mt-1 text-xs opacity-60">A target retry would use the approved snapshot and never reopen editing. No PDF service is connected here.</p>
      </section>
    );
  }

  if (!artifact) {
    return (
      <section aria-label="Document artifact" className="rounded-box border border-error bg-error/10 p-4 text-sm">
        <p role="alert" className="font-medium">Document artifact metadata is unavailable.</p>
        <p className="mt-1 text-xs opacity-70">The fixture lifecycle expects a document, but no artifact metadata is present. Preview and download controls are unavailable.</p>
      </section>
    );
  }

  const signed = state === "signed";
  const previewPages = Math.min(artifact.pageCount ?? 2, 3);
  const zoomOut = () => {
    if (previewSize === "fit") setPreviewSize(100);
    else setPreviewSize(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(previewSize) - 1)] ?? 75);
  };
  const zoomIn = () => {
    if (previewSize === "fit") setPreviewSize(125);
    else setPreviewSize(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(previewSize) + 1)] ?? 150);
  };
  return (
    <section aria-label="Document artifact" className="rounded-box border border-base-300 bg-base-200 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{name}</h3>
          <p className="text-xs opacity-60">
            <span>version {artifact.version}</span>
            {artifact.generatedAt && <span> · generated {formatAt(artifact.generatedAt)}</span>}
            {artifact.pageCount && <span> · {artifact.pageCount} pages</span>}
            {artifact.sizeLabel && <span> · {artifact.sizeLabel}</span>}
          </p>
        </div>
        <span className={`badge ${signed ? "badge-neutral" : "badge-outline"}`}>{signed ? "Signed" : "Unsigned"}</span>
      </header>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-box border border-base-300 bg-base-100 p-2 text-center text-xs">
        <div><span className="block opacity-55">Document</span><strong>Version {artifact.version}</strong></div>
        <div><span className="block opacity-55">State</span><strong>{signed ? "Signed" : "Unsigned"}</strong></div>
        <div><span className="block opacity-55">Record</span><strong>Locked</strong></div>
      </div>
      {signed && (
        meeting.signedBy ? (
          <p className="mt-2 text-sm">
            Signed by <strong>{meeting.signedBy}</strong>
            {meeting.signedAt && <span className="opacity-65"> on {formatAt(meeting.signedAt)}</span>}
          </p>
        ) : (
          <p role="alert" className="mt-2 text-sm font-medium text-error">Signer attribution is unavailable for this fixture record.</p>
        )
      )}
      <div className="sticky top-0 z-10 mt-3 flex items-start gap-2 rounded-box border border-base-300 bg-base-200/95 p-2 backdrop-blur">
        <button type="button" className="btn btn-primary min-h-11 flex-1 sm:flex-none" onClick={() => setToast(`Demo preview — the ${signed ? "signed" : "unsigned"} PDF would open in a new tab here.`)}>View PDF</button>
        <details className="dropdown dropdown-end">
          <summary className="btn btn-outline min-h-11">More document actions</summary>
          <div className="dropdown-content z-20 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-3 shadow-xl">
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-outline min-h-11 min-w-11" disabled={previewSize === 75} onClick={zoomOut} aria-label="Zoom out">−</button>
              <span className="flex-1 text-center text-sm tabular-nums">{previewSize === "fit" ? "Fit width" : `${previewSize}%`}</span>
              <button type="button" className="btn btn-outline min-h-11 min-w-11" disabled={previewSize === 150} onClick={zoomIn} aria-label="Zoom in">+</button>
            </div>
            <button type="button" className="btn btn-outline mt-2 min-h-11 w-full" onClick={() => setPreviewSize("fit")}>Reset to fit width</button>
            <button type="button" className="btn btn-outline mt-2 min-h-11 w-full" onClick={() => setToast(`Demo preview — the ${signed ? "signed" : "unsigned"} PDF download would start here.`)}>Download PDF</button>
          </div>
        </details>
      </div>
      <div className="mt-3 overflow-x-auto rounded-box border border-base-300 bg-base-100 p-2 sm:p-4" aria-label="Document preview">
        <div
          className="mx-auto grid gap-4"
          style={{ width: previewSize === "fit" ? "min(100%, 28rem)" : `${(28 * previewSize) / 100}rem` }}
        >
          {Array.from({ length: previewPages }, (_, page) => (
            <div key={page} className={`aspect-[1/1.29] rounded-sm border border-base-300 bg-base-100 p-4 shadow-sm ${page > 0 ? "hidden sm:block" : ""}`}>
              <div className="h-3 w-2/3 rounded bg-base-content/15" />
              <div className="mt-3 space-y-2">
                {Array.from({ length: 9 }, (_, line) => (
                  <div key={line} className={`h-1.5 rounded bg-base-content/10 ${line % 4 === 3 ? "w-1/2" : "w-full"}`} />
                ))}
              </div>
              {signed && page === previewPages - 1 && (
                <div className="mt-4 border-t border-base-300 pt-2 text-[10px] italic opacity-60">Signature panel — {meeting.signedBy ?? "attribution unavailable"}</div>
              )}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-3 text-xs opacity-60">
        {signed
          ? "The demo lifecycle represents a signed PDF that superseded the unsigned artifact; no signed file exists in this frontend."
          : "This demo preview represents the exact locked document a Treasurer would sign; no PDF or signature is created here."}
      </p>
      {toast && <Toast message={toast} tone="success" clear={() => setToast("")} />}
    </section>
  );
}
