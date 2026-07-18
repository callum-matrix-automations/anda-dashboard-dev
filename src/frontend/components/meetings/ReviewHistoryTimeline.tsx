import type { HistoryAction, ReviewHistoryEntry } from "@/shared/types";
import { newestFirst } from "@/frontend/presentation/history";

// AIDEV-NOTE: Operator-language labels for the append-only audit trail. Entries carry
// actions only — never field snapshots — so the timeline states WHAT happened, not diffs.
const actionLabel: Record<HistoryAction, string> = {
  imported: "Transcript imported",
  analysis_started: "Automatic analysis started",
  analysis_completed: "Automatic analysis completed",
  analysis_failed: "Automatic analysis failed",
  analysis_retried: "Analysis retried",
  edit_saved: "Draft edited",
  marked_ready: "Marked ready for review",
  deferred: "Review deferred",
  resumed: "Review resumed",
  approved: "Minutes approved",
  pdf_generated: "Unsigned PDF generated",
  pdf_failed: "PDF generation failed",
  pdf_retried: "PDF generation retried",
  rejected: "Returned for changes",
  signed: "Minutes signed",
  signature_failed: "Signature delivery failed",
  signature_retried: "Signature delivery retried",
  archived: "Signed record archived",
  archive_failed: "Archive delivery failed",
  tags_updated: "Tags updated",
};

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ReviewHistoryTimeline({ history }: { history: ReviewHistoryEntry[] }) {
  if (!history.length) {
    return <p className="py-8 text-center text-sm opacity-60">No review activity recorded yet for this meeting.</p>;
  }
  return (
    <div>
      <p role="note" className="mb-3 text-xs opacity-70">Fixture history only — no provider, AI, PDF, signature, or archive service events occurred.</p>
      <ol aria-label="Review history" className="space-y-0">
        {newestFirst(history).map((entry, index, all) => (
          <li key={entry.id} className="relative flex gap-3 pb-4">
            <div aria-hidden="true" className="flex flex-col items-center">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-base-content/60" />
              {index < all.length - 1 && <span className="w-px flex-1 bg-base-300" />}
            </div>
            <div className="min-w-0 text-sm">
              <p>
                <strong>{actionLabel[entry.action]}</strong>
                <span className="opacity-60"> — {entry.actor}</span>
              </p>
              <time dateTime={entry.at} className="text-xs opacity-55">{formatAt(entry.at)}</time>
              {entry.note && <p className="mt-1 text-xs opacity-75">{entry.note}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
