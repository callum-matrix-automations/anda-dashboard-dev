import { InfoIcon } from "@phosphor-icons/react";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { cn } from "@/frontend/components/design-system/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/frontend/components/design-system/primitives/tooltip";
import type { MotionApprovalIssue } from "@/frontend/presentation/meetingApprovalReadiness";
import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export type MeetingTab = "Minutes" | "Transcript" | "Attendance" | "Motions";

export function MeetingTabs({
  meeting,
  tab,
  highlightedMotionIndexes = [],
  motionIssues,
  onEditMotion,
}: {
  meeting: MeetingApiDetail;
  tab: MeetingTab;
  highlightedMotionIndexes?: number[];
  motionIssues?: MotionApprovalIssue[];
  onEditMotion?: (motionIndex: number) => void;
}) {
  if (tab === "Transcript") {
    return <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-4 font-sans text-sm leading-7">{meeting.transcript.content}</pre>;
  }

  if (tab === "Attendance") {
    return meeting.attendees.length > 0 ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {meeting.attendees.map((attendee) => (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2" key={attendee.attendeeId}>
            <strong>{attendee.displayName}</strong>
            <Badge variant="success">Present</Badge>
          </div>
        ))}
      </div>
    ) : <p className="text-muted-foreground">No attendees were linked to active profiles.</p>;
  }

  if (tab === "Motions") {
    const displayNames = new Map(meeting.attendees.map((attendee) => [attendee.profileId, attendee.displayName]));
    return meeting.motions.length > 0 ? (
      <div className="space-y-3">
        {meeting.motions.map((motion, motionIndex) => {
          const needsAttention = highlightedMotionIndexes.includes(motionIndex);
          const motionIssue = motionIssues?.find((issue) => issue.motionIndex === motionIndex);
          return (
          <article
            className={cn("rounded-lg border bg-card p-4", needsAttention ? "border-warning/60 bg-warning/5 ring-1 ring-warning/30" : "border-border")}
            data-needs-attention={needsAttention || undefined}
            key={motion.motionId}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-medium">{motion.text}</h3>
                {needsAttention && motionIssue && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-warning">Requires attention before approval</p>
                    <Tooltip>
                      <TooltipTrigger
                        aria-label={`View issues for motion ${motionIndex + 1}`}
                        className="inline-flex size-5 items-center justify-center rounded-full text-warning outline-none hover:bg-warning/15 focus-visible:ring-2 focus-visible:ring-warning/40"
                      >
                        <InfoIcon className="size-4" weight="bold" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm items-start py-2">
                        <ul className="list-disc space-y-1 pl-3">
                          {motionIssue.messages.map((message) => <li key={message}>{message}</li>)}
                        </ul>
                      </TooltipContent>
                    </Tooltip>
                    {onEditMotion && (
                      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs font-bold" onClick={() => onEditMotion(motionIndex)}>
                        Edit now
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <Badge variant={outcomeVariant(motion.outcome)}>{outcomeLabel(motion.outcome)}</Badge>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Moved by</dt><dd>{profileName(motion.moverProfileId, displayNames)}</dd></div>
              <div><dt className="text-muted-foreground">Seconded by</dt><dd>{motion.outcome === "not_seconded" ? "No seconder — not put to vote" : profileName(motion.seconderProfileId, displayNames)}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              {motion.votes.map((vote) => (
                <Badge variant={voteVariant(vote.selection)} key={vote.voteId}>
                  {profileName(vote.profileId, displayNames)}: {vote.selection}
                </Badge>
              ))}
              {motion.votes.length === 0 && <span className="text-sm text-muted-foreground">No individual votes recorded.</span>}
            </div>
          </article>
          );
        })}
      </div>
    ) : <p className="text-muted-foreground">No motions were identified in this meeting.</p>;
  }

  if (!meeting.minutes) {
    return <p className="text-muted-foreground">Minutes are not available yet. The source transcript remains available while analysis is in progress.</p>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg bg-muted p-4">
        <h3 className="font-semibold">Summary</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{meeting.minutes.summary}</p>
      </section>
      {meeting.minutes.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`}>
          <h3 className="font-semibold">{section.heading}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{section.content}</p>
        </section>
      ))}
    </div>
  );
}

function profileName(profileId: string | null, displayNames: Map<string, string>): string {
  if (!profileId) return "Not identified";
  return displayNames.get(profileId) ?? "Unknown attendee";
}

function outcomeLabel(outcome: MeetingApiDetail["motions"][number]["outcome"]): string {
  if (outcome === "not_seconded") return "Not seconded";
  return outcome.charAt(0).toUpperCase() + outcome.slice(1);
}

function outcomeVariant(outcome: MeetingApiDetail["motions"][number]["outcome"]): "success" | "warning" | "destructive" | "outline" {
  switch (outcome) {
    case "carried":
      return "success";
    case "failed":
      return "destructive";
    case "tabled":
    case "unresolved":
      return "warning";
    case "not_seconded":
      return "outline";
  }
}

function voteVariant(selection: MeetingApiDetail["motions"][number]["votes"][number]["selection"]): "success" | "warning" | "destructive" | "outline" {
  switch (selection) {
    case "for":
      return "success";
    case "against":
      return "destructive";
    case "unresolved":
      return "warning";
    case "abstain":
      return "outline";
  }
}
