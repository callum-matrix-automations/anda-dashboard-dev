import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { statusLabel, statusTone } from "./meetingPresentation";
import type { MeetingStatus } from "@/shared/types";

// AIDEV-NOTE: One source of truth for how a meeting status reads across every screen
// (queues, search, review, signing). Replaces the ad-hoc `text-error`-or-nothing spans.
export function StatusBadge({ status, className }: { status: MeetingStatus; className?: string }) {
  return (
    <Badge variant={statusTone[status]} className={className}>
      {statusLabel[status]}
    </Badge>
  );
}
