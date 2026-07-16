import type { Meeting } from "@/domain/types";
import { MAX_ANALYSIS_ATTEMPTS, analysisAttemptsExhausted } from "@/domain/analysis";

const EXTRACTED_AREAS = ["Minutes", "Attendance", "Motions", "Votes"] as const;

type AnalysisMeeting = Pick<Meeting, "status" | "analysisAttempt" | "failureReason" | "humanOwned">;

// AIDEV-NOTE: Honest progress only — no fake timers or simulated network. The surface
// states which attempt the record is on; it never animates progress it cannot know.
export function AnalysisProgress({ meeting }: { meeting: AnalysisMeeting }) {
  const failed = meeting.status === "AI_FAILED";
  const exhausted = analysisAttemptsExhausted(meeting);

  // Once a human owns the draft, fixture analysis state may never replace it.
  if (meeting.humanOwned) {
    return (
      <section aria-label="Analysis status" className="border-b border-base-300 bg-base-100 px-4 py-3 text-sm">
        <span className="badge badge-outline badge-sm mr-2">Human-owned</span>
        This fixture record is maintained manually by officers. No analysis service runs or replaces its content.
      </section>
    );
  }

  return (
    <section aria-label="Analysis progress" className="border-b border-base-300 bg-base-100 px-4 py-3">
      {failed ? (
        <div role="alert" className="text-sm">
          <p className="font-semibold text-error">
            {exhausted
              ? `Fixture analysis state failed — all ${MAX_ANALYSIS_ATTEMPTS} automatic attempts exhausted.`
              : `Fixture analysis state failed on attempt ${meeting.analysisAttempt} of ${MAX_ANALYSIS_ATTEMPTS}.`}
          </p>
          {meeting.failureReason && <p className="mt-1 opacity-75">Fixture failure detail: {meeting.failureReason}</p>}
          <p className="mt-1 text-xs opacity-60">
            Retry Analysis changes local demo state; no AI service is called. Complete Manually builds the fixture record in this browser session.
          </p>
        </div>
      ) : (
        <div className="text-sm">
          <p><span className="badge badge-outline badge-sm mr-2">Demo status</span>Fixture lifecycle is at analysis processing — attempt {meeting.analysisAttempt} of {MAX_ANALYSIS_ATTEMPTS}.</p>
          <p className="mt-1 text-xs opacity-60">No AI service is running; this status and its eventual output come from local fixtures.</p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {EXTRACTED_AREAS.map((area) => (
          <div key={area} className="rounded-box border border-base-300 bg-base-200 px-3 py-2">
            <dt className="text-xs font-medium">{area}</dt>
            <dd className="text-xs opacity-60">Awaiting fixture result</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
