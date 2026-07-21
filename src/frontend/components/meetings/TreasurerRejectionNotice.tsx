import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";

export function TreasurerRejectionNotice({ meeting }: { meeting: MeetingApiDetail }) {
  const rejected = [...meeting.history]
    .filter((entry) => entry.action === "TREASURER_REJECTED")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (!rejected || meeting.status !== "PENDING_APPROVAL") return null;
  const reapproved = meeting.history.some(
    (entry) => entry.action === "APPROVED" && entry.createdAt > rejected.createdAt,
  );
  if (reapproved) return null;

  return (
    <div role="status" className="alert alert-warning rounded-none border-x-0 border-t-0">
      <div>
        <strong>Returned by the Treasurer for corrections.</strong>
        <p className="mt-1 text-sm">{rejected.note ?? "No correction comment was recorded."}</p>
        <p className="mt-1 text-xs opacity-70">Returned by {rejected.actorDisplayName} on {formatAt(rejected.createdAt)}. Correct the draft and approve it again to create a new document version.</p>
      </div>
    </div>
  );
}

function formatAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
