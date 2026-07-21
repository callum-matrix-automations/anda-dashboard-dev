"use client";

import { useState } from "react";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { matchedParticipants, unmatchedParticipants } from "@/frontend/presentation/provenance";

type MeetingSourcePanelProps = Pick<MeetingApiDetail, "source" | "sourceParticipants">;

export function MeetingSourcePanel({ source, sourceParticipants }: MeetingSourcePanelProps) {
  const matched = matchedParticipants(sourceParticipants);
  const unmatched = unmatchedParticipants(sourceParticipants);
  const [copyStatus, setCopyStatus] = useState("");

  const copyReference = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(source.sourceMeetingId);
      setCopyStatus("Reference copied");
    } catch {
      setCopyStatus("Copy unavailable. Select the reference and copy it manually.");
    }
  };

  return (
    <details className="collapse-arrow collapse border-b border-base-300 bg-base-100">
      <summary className="collapse-title min-h-11 cursor-pointer px-4 py-2.5 text-sm font-medium hover:bg-base-200">
        <span>Meeting source · Read AI</span>
        <span className="badge badge-outline badge-sm ml-2 align-middle">Imported</span>
        {unmatched.length > 0 && (
          <span className="badge badge-error badge-sm ml-2 align-middle">
            {unmatched.length} unmatched participant{unmatched.length === 1 ? "" : "s"}
          </span>
        )}
      </summary>
      <div className="collapse-content space-y-4 px-4 text-sm">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SourceValue label="Started" value={formatDateTime(source.startedAt)} />
          <SourceValue label="Ended" value={formatDateTime(source.endedAt)} />
          <SourceValue label="Duration" value={source.durationMinutes ? `${source.durationMinutes} minutes` : "Not supplied"} />
          <SourceValue label="Imported" value={formatDateTime(source.importedAt)} />
        </dl>
        <div className="grid min-w-0 gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide opacity-55">Read AI meeting reference</span>
          <code className="select-all break-words text-xs leading-5 [overflow-wrap:anywhere]">{source.sourceMeetingId}</code>
          <button type="button" className="btn btn-outline btn-sm min-h-11 w-full sm:w-fit" onClick={() => void copyReference()}>Copy reference</button>
          {copyStatus && <span role="status" aria-live="polite" className="text-xs opacity-70">{copyStatus}</span>}
        </div>
        {sourceParticipants.length === 0 ? (
          <p className="opacity-60">Read AI did not supply participant details for this meeting.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Matched participants</h3>
              <ul aria-label="Matched participants" className="mt-2 space-y-2">
                {matched.map((participant, index) => (
                  <li key={participantKey(participant, index)} className="rounded-field border border-base-300 p-2">
                    <span className="font-medium">{participant.displayName}</span>
                    <span className="badge badge-success badge-sm ml-2">Profile linked</span>
                    <span className="block text-xs opacity-60">{participant.email ?? "No email supplied"}</span>
                  </li>
                ))}
                {matched.length === 0 && <li className="opacity-60">No participants matched an active profile.</li>}
              </ul>
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Unmatched participants</h3>
              <ul aria-label="Unmatched participants" className="mt-2 space-y-2">
                {unmatched.map((participant, index) => (
                  <li key={participantKey(participant, index)} className="rounded-field border border-base-300 p-2">
                    <span className="font-medium">{participant.displayName}</span>
                    <span className="block text-xs opacity-60">{participant.email ?? "No valid email supplied"}</span>
                    <span className="block text-xs opacity-60">No active ANDA profile was matched.</span>
                  </li>
                ))}
                {unmatched.length === 0 && <li className="opacity-60">Every supplied participant is linked to a profile.</li>}
              </ul>
            </section>
          </div>
        )}
        <p className="text-xs opacity-60">The source transcript is read-only. Unmatched participants remain in the transcript but are not added to structured attendance or voting.</p>
      </div>
    </details>
  );
}

function SourceValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide opacity-55">{label}</dt><dd className="mt-1">{value}</dd></div>;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "Not supplied";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function participantKey(
  participant: MeetingApiDetail["sourceParticipants"][number],
  index: number,
): string {
  return participant.email ?? `${participant.displayName}-${index}`;
}
