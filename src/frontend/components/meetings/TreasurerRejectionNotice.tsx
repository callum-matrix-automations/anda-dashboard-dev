import type { MeetingApiDetail } from "@/shared/contracts/meetingApi";
import { StatusBanner } from "./StatusBanner";

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
    <StatusBanner tone="warning">
      <div>
        <strong>Returned by the Treasurer for corrections.</strong>
        <p className="mt-1 text-sm">{rejected.note ?? "No correction comment was recorded."}</p>
        <p className="mt-1 text-xs text-muted-foreground">Returned by {rejected.actorDisplayName} on {formatAt(rejected.createdAt)}. Correct the draft and approve it again to create a new document version.</p>
      </div>
    </StatusBanner>
  );
}

function formatAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
