"use client";

import { useState } from "react";
import type { MeetingSource, TranscriptImportStatus } from "@/shared/types";
import { matchedParticipants, unmatchedParticipants } from "@/frontend/presentation/provenance";

// AIDEV-NOTE: Deliberately a read-only provenance panel — there is NO intake/upload
// screen in this product. This surface answers "where did this transcript come from"
// on meeting detail in review, signing, and archive modes alike.

const importStatusLabel: Record<TranscriptImportStatus, string> = {
  imported: "Imported",
  imported_with_gaps: "Imported with gaps",
  import_failed: "Import failed",
};

const importStatusBadge: Record<TranscriptImportStatus, string> = {
  imported: "badge-outline",
  // AIDEV-NOTE: Gaps need operator attention but are not a system failure;
  // keep them neutral so red remains reserved for genuine exceptions.
  imported_with_gaps: "badge-outline",
  import_failed: "badge-error",
};

function formatImportedAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function MeetingSourcePanel({ source }: { source: MeetingSource }) {
  const matched = matchedParticipants(source);
  const unmatched = unmatchedParticipants(source);
  const [copyStatus, setCopyStatus] = useState("");
  const copyReference = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(source.reference);
      setCopyStatus("Reference copied");
    } catch {
      setCopyStatus("Copy unavailable. Select the reference and copy it manually.");
    }
  };
  return (
    <details className="collapse-arrow collapse border-b border-base-300 bg-base-100">
      <summary className="collapse-title min-h-11 cursor-pointer px-4 py-2.5 text-sm font-medium hover:bg-base-200">
        <span>Meeting Source · </span>
        <span>{source.provider}</span>
        <span className={`badge badge-sm ml-2 align-middle ${importStatusBadge[source.importStatus]}`}>
          {importStatusLabel[source.importStatus]}
        </span>
        {unmatched.length > 0 && (
          <span className="badge badge-error badge-sm ml-2 align-middle">
            {unmatched.length} unmatched speaker{unmatched.length === 1 ? "" : "s"}
          </span>
        )}
      </summary>
      <div className="collapse-content space-y-3 px-4 text-sm">
        <p role="note" className="text-xs opacity-70">Fixture provenance only. No Teams connection or transcript intake occurs in this frontend.</p>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div className="grid min-w-0 gap-2">
            <dt className="opacity-55">Meeting reference</dt>
            <dd className="select-all break-words font-mono text-xs leading-5 [overflow-wrap:anywhere]">{source.reference}</dd>
            <button type="button" className="btn btn-outline btn-sm min-h-11 w-full sm:w-fit" onClick={() => void copyReference()}>Copy reference</button>
            {copyStatus && <span role="status" aria-live="polite" className="text-xs opacity-70">{copyStatus}</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="opacity-55">Imported at</dt>
            <dd>{formatImportedAt(source.importedAt)}</dd>
          </div>
        </dl>
        {source.participants.length === 0 ? (
          <p className="opacity-60">No participants were captured with this import.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Matched participants</h3>
              <ul aria-label="Matched participants" className="mt-1 space-y-1">
                {matched.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2">
                    <span>{p.displayName}</span>
                    <span className="badge badge-outline badge-sm">{p.memberName}</span>
                  </li>
                ))}
                {matched.length === 0 && <li className="opacity-60">None matched yet.</li>}
              </ul>
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Unmatched speakers</h3>
              <ul aria-label="Unmatched speakers" className="mt-1 space-y-1">
                {unmatched.map((p) => (
                  <li key={p.id}>
                    <span className="font-medium">{p.displayName}</span>
                    <span className="block text-xs opacity-60">{p.reason}</span>
                  </li>
                ))}
                {unmatched.length === 0 && <li className="opacity-60">Every speaker is matched to a member.</li>}
              </ul>
            </section>
          </div>
        )}
        <p className="text-xs opacity-60">
          Unmatched speakers remain in the transcript but are excluded from structured attendance and voting until resolved.
          The source transcript is read-only.
        </p>
      </div>
    </details>
  );
}
