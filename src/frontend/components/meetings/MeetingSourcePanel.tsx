"use client";

import { useState } from "react";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { matchedParticipants, unmatchedParticipants } from "@/frontend/presentation/provenance";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/frontend/components/design-system/primitives/collapsible";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { CaretDownIcon } from "@phosphor-icons/react";

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
    <Collapsible className="border-b border-border bg-card">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <CaretDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
        <span>Meeting source · Read AI</span>
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
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Read AI meeting reference</span>
          <code className="select-all break-words text-xs leading-5 [overflow-wrap:anywhere]">{source.sourceMeetingId}</code>
          <Button variant="outline" size="sm" className="w-full sm:w-fit" onClick={() => void copyReference()}>Copy reference</Button>
          {copyStatus && <span role="status" aria-live="polite" className="text-xs text-muted-foreground">{copyStatus}</span>}
        </div>
        {sourceParticipants.length === 0 ? (
          <p className="text-muted-foreground">Read AI did not supply participant details for this meeting.</p>
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
        <p className="text-xs text-muted-foreground">The source transcript is read-only. Unmatched participants remain in the transcript but are not added to structured attendance or voting.</p>
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
