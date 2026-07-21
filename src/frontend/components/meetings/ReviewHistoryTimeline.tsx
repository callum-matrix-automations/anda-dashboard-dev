import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { newestFirst } from "@/frontend/presentation/history";

type HistoryEntry = MeetingApiDetail["history"][number];

const actionLabel: Record<HistoryEntry["action"], string> = {
  EDIT_SAVED: "Draft edited",
  MARKED_READY: "Marked ready for review",
  DEFERRED: "Review deferred",
  RESUMED: "Review resumed",
  APPROVED: "Minutes approved",
  SIGNED: "Minutes signed",
  TREASURER_REJECTED: "Returned for changes",
  AI_RETRY: "AI analysis retried",
  PDF_RETRY: "PDF generation retried",
  ESIGN_RETRY: "Signature delivery retried",
};

export function ReviewHistoryTimeline({ history }: { history: HistoryEntry[] }) {
  if (!history.length) {
    return <p className="py-8 text-center text-sm opacity-60">No review activity has been recorded for this meeting.</p>;
  }

  return (
    <ol aria-label="Review history" className="space-y-0">
      {newestFirst(history).map((entry, index, all) => (
        <li key={entry.id} className="relative flex gap-3 pb-4">
          <div aria-hidden="true" className="flex flex-col items-center">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-base-content/60" />
            {index < all.length - 1 && <span className="w-px flex-1 bg-base-300" />}
          </div>
          <div className="min-w-0 text-sm">
            <p><strong>{actionLabel[entry.action]}</strong><span className="opacity-60"> — {entry.actorDisplayName}</span></p>
            <time dateTime={entry.createdAt} className="text-xs opacity-55">{formatAt(entry.createdAt)}</time>
            {entry.note && <p className="mt-1 text-xs opacity-75">{entry.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatAt(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
