import type { Meeting } from "@/domain/types";
import { countUnresolvedVotes, isApprovalLocked } from "@/domain/stateMachine";
import { attendanceIssues, draftIssues, minutesIssues, motionIssues } from "@/domain/manualDraft";
import { matchedParticipants, unmatchedParticipants } from "@/domain/provenance";
import { statusLabel, statusText } from "@/components/shared/meetingPresentation";
import { TagsEditor } from "./TagsEditor";

interface ReviewSummaryProps {
  meeting: Meeting;
  onOpenTab: (tab: string) => void;
  canEditTags: boolean;
  tagsBusy: boolean;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// AIDEV-NOTE: One consolidated lifecycle view: source, ownership, completeness,
// exceptions, readiness, and approval state — with jump links so reviewers never hunt.
export function ReviewSummary({ meeting, onOpenTab, canEditTags, tagsBusy, onAddTag, onRemoveTag }: ReviewSummaryProps) {
  const unresolved = countUnresolvedVotes(meeting);
  const matched = matchedParticipants(meeting.source).length;
  const unmatched = unmatchedParticipants(meeting.source).length;
  const present = meeting.attendees.filter((a) => a.present).length;
  const draftExists = meeting.minutes.length > 0;
  const minutesProblemCount = minutesIssues(meeting.minutes).length;
  const attendanceProblemCount = attendanceIssues(meeting.attendees).length;
  const motionProblemCount = motionIssues(meeting.motions).length;
  const contentComplete = draftIssues(meeting).length === 0;
  const deferred = meeting.deferredAt !== null;
  const approvalComplete = isApprovalLocked(meeting.status);
  const analysisInProgress = meeting.status === "AI_PROCESSING";
  const ready = meeting.status === "PENDING_APPROVAL" && contentComplete && !deferred;
  const readyAfterResume = meeting.status === "PENDING_APPROVAL" && contentComplete && deferred;
  const sourceGap = meeting.source.importStatus !== "imported";
  const advisoryLabel = [unmatched > 0 ? "Unmatched speakers" : null, sourceGap ? "source import gaps" : null]
    .filter((value): value is string => value !== null)
    .join(" and ");
  const readinessHeading = ready
    ? "Ready to approve"
    : readyAfterResume
      ? "Ready after resume"
      : approvalComplete
        ? "Approval complete"
        : analysisInProgress
          ? "Demo analysis in progress"
        : "Needs attention";
  const readinessCopy = ready
    ? "Ready for officer approval. Approval locks this exact demo record and advances its local status to PDF processing; no PDF service runs."
    : readyAfterResume
      ? "Content is complete. Resume the deferred record before approval."
      : approvalComplete
        ? "This demo record has passed approval and is locked. Its current local lifecycle state is shown below."
        : analysisInProgress
          ? "The fixture lifecycle is at analysis processing. No AI service is running and no approval has been recorded."
        : "Resolve the blocking content or lifecycle items before approval.";
  const neutralReadiness = ready || readyAfterResume || approvalComplete || analysisInProgress;

  return (
    <div className="space-y-4">
      {meeting.rejection && (
        <div role="alert" className="alert alert-error">
          <span>
            <strong>Returned for changes by {meeting.rejection.by}:</strong> {meeting.rejection.comment}
          </span>
        </div>
      )}
      <section className={`rounded-box border p-4 ${neutralReadiness ? "border-base-300 bg-base-200" : "border-error bg-error/10"}`} aria-labelledby="readiness-heading">
        <h2 id="readiness-heading" className="text-lg font-semibold">{readinessHeading}</h2>
        <p className="mt-1 text-sm">{readinessCopy}</p>
        {unresolved > 0 && (
          <p className="mt-2 text-sm"><strong>{plural(unresolved, "unresolved vote")}</strong> will remain visible in the approved record and does not block approval.</p>
        )}
        {advisoryLabel && (
          <p className="mt-2 text-sm">{advisoryLabel} are advisory fixture-provenance exceptions. They remain visible and do not block approval.</p>
        )}
        <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
          {unresolved > 0 && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Motions")}>Review {plural(unresolved, "unresolved vote")}</button>
          )}
          {unmatched > 0 && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Transcript")}>Review {plural(unmatched, "unmatched speaker")}</button>
          )}
          {sourceGap && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Transcript")}>Review source import gap</button>
          )}
          {minutesProblemCount > 0 && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Minutes")}>Review {plural(minutesProblemCount, "minutes issue")}</button>
          )}
          {attendanceProblemCount > 0 && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Attendance")}>Review {plural(attendanceProblemCount, "attendance issue")}</button>
          )}
          {motionProblemCount > 0 && (
            <button className="btn btn-outline min-h-11" onClick={() => onOpenTab("Motions")}>Review {plural(motionProblemCount, "motion issue")}</button>
          )}
        </div>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Source</h3>
          <p className="mt-1">Fixture source recorded from {meeting.source.provider} · fixture timestamp {formatAt(meeting.source.importedAt)}</p>
          <p className="text-xs opacity-65">{matched} matched, {unmatched} unmatched participant{unmatched === 1 ? "" : "s"}</p>
        </section>
        <section className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Draft ownership</h3>
          <p className="mt-1">
            {meeting.humanOwned
              ? "Human-owned draft — maintained by officers in local demo state; no service will replace it in this frontend."
              : draftExists
                ? "Fixture analysis draft — review before approval. No AI service ran."
                : "No structured draft yet."}
          </p>
        </section>
        <section className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Structured content</h3>
          <ul className="mt-1 space-y-0.5">
            <li>{plural(meeting.minutes.length, "minutes section")}</li>
            <li>Attendance: {present} of {meeting.attendees.length} present</li>
            <li>{plural(meeting.motions.length, "motion")}</li>
            <li className={unresolved > 0 ? "font-medium text-error" : undefined}>
              {plural(unresolved, "unresolved vote")}
            </li>
          </ul>
        </section>
        <section className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Lifecycle</h3>
          <p className="mt-1">
            <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
          </p>
          {meeting.failureReason && <p className="mt-1 text-xs text-error">{meeting.failureReason}</p>}
          {meeting.deferredAt && (
            <p className="mt-1 text-xs opacity-65">Deferred{meeting.deferredNote ? ` — ${meeting.deferredNote}` : ""}</p>
          )}
          <p className="mt-1 text-xs opacity-65">
            {ready
              ? "Ready for officer approval."
              : readyAfterResume
                ? "Content complete; resume before approval."
                : approvalComplete
                  ? "Approval already recorded in local demo state."
                  : analysisInProgress
                    ? "Fixture analysis state in progress; approval not recorded."
                  : "Not ready for approval yet."}
          </p>
        </section>
      </div>
      <section className="rounded-box border border-base-300 bg-base-200 p-3 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wide opacity-55">Tags</h3>
        <div className="mt-2">
          <TagsEditor tags={meeting.tags} editable={canEditTags} busy={tagsBusy} onAdd={onAddTag} onRemove={onRemoveTag} />
        </div>
      </section>
      <button className="btn btn-outline min-h-11 w-full sm:w-auto" onClick={() => onOpenTab("History")}>Review decision history</button>
    </div>
  );
}
