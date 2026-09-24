"use client";

import { useState } from "react";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { matchedParticipants, unmatchedParticipants } from "@/frontend/presentation/provenance";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/frontend/components/design-system/primitives/collapsible";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useRenormalizeMeetingTranscript } from "@/frontend/hooks/useApi";
import { meetingMutationErrorMessage } from "@/frontend/presentation/meetingMutationError";

type MeetingSourcePanelProps = Pick<MeetingApiDetail,
  "id" | "version" | "status" | "humanOwned" | "source" | "sourceParticipants"
> & { onFeedback: (message: string, tone: "error" | "success") => void };

export function MeetingSourcePanel({
  id,
  version,
  status,
  humanOwned,
  source,
  sourceParticipants,
  onFeedback,
}: MeetingSourcePanelProps) {
  const matched = matchedParticipants(sourceParticipants);
  const unmatched = unmatchedParticipants(sourceParticipants);
  const [copyStatus, setCopyStatus] = useState("");
  const renormalize = useRenormalizeMeetingTranscript();
  const sourceName = source.provider === "manual_upload" ? "Manual upload" : source.provider === "read_ai" ? "Read AI" : "Imported transcript";
  const canRenormalize = source.provider === "manual_upload"
    && !humanOwned
    && (status === "PENDING_APPROVAL" || status === "AI_FAILED");

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
    <Collapsible className="border-b border-border bg-card">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <CaretDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
        <span>Meeting source · {sourceName}</span>
        <Badge variant="outline">Imported</Badge>
        {unmatched.length > 0 && (
          <Badge variant="destructive">
            {unmatched.length} unmatched participant{unmatched.length === 1 ? "" : "s"}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-4 pb-4 text-sm">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SourceValue label="Started" value={formatDateTime(source.startedAt)} />
          <SourceValue label="Ended" value={formatDateTime(source.endedAt)} />
          <SourceValue label="Duration" value={source.durationMinutes ? `${source.durationMinutes} minutes` : "Not supplied"} />
          <SourceValue label="Imported" value={formatDateTime(source.importedAt)} />
        </dl>
        <div className="grid min-w-0 gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source reference</span>
          <code className="select-all break-words text-xs leading-5 [overflow-wrap:anywhere]">{source.sourceMeetingId}</code>
          <Button variant="outline" size="sm" className="w-full sm:w-fit" onClick={() => void copyReference()}>Copy reference</Button>
          {copyStatus && <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{copyStatus}</span>}
        </div>
        {sourceParticipants.length === 0 ? (
          <p className="text-muted-foreground">The source did not supply participant details for this meeting.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matched participants</h3>
              <ul aria-label="Matched participants" className="mt-2 space-y-2">
                {matched.map((participant, index) => (
                  <li key={participantKey(participant, index)} className="rounded-lg border border-border p-2">
                    <span className="font-medium">{participant.displayName}</span>
                    <Badge variant="success" className="ml-2">Profile linked</Badge>
                    <span className="block text-xs text-muted-foreground">{participant.email ?? "No email supplied"}</span>
                  </li>
                ))}
                {matched.length === 0 && <li className="text-muted-foreground">No participants matched an active profile.</li>}
              </ul>
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unmatched participants</h3>
              <ul aria-label="Unmatched participants" className="mt-2 space-y-2">
                {unmatched.map((participant, index) => (
                  <li key={participantKey(participant, index)} className="rounded-lg border border-border p-2">
                    <span className="font-medium">{participant.displayName}</span>
                    <span className="block text-xs text-muted-foreground">{participant.email ?? "No valid email supplied"}</span>
                    <span className="block text-xs text-muted-foreground">No active ANDA profile was matched.</span>
                  </li>
                ))}
                {unmatched.length === 0 && <li className="text-muted-foreground">Every supplied participant is linked to a profile.</li>}
              </ul>
            </section>
          </div>
        )}
        {source.normalization && (
          <section className="rounded-lg border border-border bg-muted/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcript check</h3>
            <p className="mt-1 text-sm">
              {source.normalization.turnCount} speaker turns · {source.normalization.participants.length} speaker labels · {Math.round(source.normalization.attributionCoverage * 100)}% attributed
            </p>
            {source.normalization.warnings.length > 0 ? (
              <ul aria-label="Transcript warnings" className="mt-2 space-y-1 text-sm text-amber-700 dark:text-amber-300">
                {source.normalization.warnings.map((warning) => <li key={warning.code}>• {warning.message}</li>)}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No transcript-format warnings were found.</p>
            )}
          </section>
        )}
        {canRenormalize && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Re-checking creates a new audit version and replaces the AI draft. It is disabled after human edits or approval.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={renormalize.isPending}
              onClick={() => renormalize.mutate({ meetingId: id, expectedVersion: version }, {
                onSuccess: () => onFeedback("Transcript re-checked and the AI draft was replaced.", "success"),
                onError: (error) => onFeedback(meetingMutationErrorMessage(error), "error"),
              })}
            >
              {renormalize.isPending ? "Re-checking..." : "Re-check transcript"}
            </Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">The original source transcript is read-only. Unmatched participants remain available as source-only attendees for review, motions, and voting.</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>;
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
