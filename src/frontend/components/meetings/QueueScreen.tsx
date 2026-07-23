"use client";

import { useMeetings } from "@/frontend/hooks/useApi";
import { MeetingTable } from "@/frontend/components/shared/MeetingTable";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import type { MeetingApiQueue } from "@/shared/contracts/meetingApi";

const copy = {
  meetings: ["All meetings", "Browse meeting records returned by the backend API."],
  "needs-review": ["Needs review", "Meetings requiring an authorised review decision."],
  deferred: ["Deferred", "Meetings awaiting external information."],
  signing: ["Signing", "Meetings awaiting an authorised signature."],
  archive: ["Archive", "Completed signed meeting records."],
} as const;

type QueueScreenName = keyof typeof copy;

const apiQueue: Record<QueueScreenName, MeetingApiQueue> = {
  meetings: "all",
  "needs-review": "needs-review",
  deferred: "deferred",
  signing: "signing",
  archive: "archive",
};

export function QueueScreen({ queue }: { queue: QueueScreenName }) {
  const query = useMeetings(apiQueue[queue]);
  const [title, description] = copy[queue];
  const heading = (
    <div>
      <div className="text-[.7rem] font-semibold tracking-wide text-secondary">Meeting records · {title}</div>
      <h1 className="mt-0.5 text-[1.7rem] font-semibold">{title}</h1>
      <p className="mt-0.5 text-[.86rem] text-muted-foreground">{description}</p>
    </div>
  );

  if (query.isLoading) return <LoadingState label={`Loading ${title.toLowerCase()}`} />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} /></div>;

  return (
    <div className="grid gap-4">
      {heading}
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm shadow-primary/5 sm:p-4">
        <MeetingTable meetings={query.data?.items ?? []} browseAll={queue === "meetings"} reviewAccess signerAccess emptyMessage="No records were returned." />
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Meeting records could not be loaded.";
}
