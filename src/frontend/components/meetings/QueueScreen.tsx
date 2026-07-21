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
  const heading = <div><div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>{title}</li></ul></div><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm opacity-60">{description}</p></div>;

  if (query.isLoading) return <LoadingState label={`Loading ${title.toLowerCase()}`} />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} /></div>;

  return <div className="grid gap-4">{heading}<div className="card border border-base-300 bg-base-200"><div className="card-body p-3 sm:p-4"><MeetingTable meetings={query.data?.items ?? []} browseAll={queue === "meetings"} reviewAccess signerAccess emptyMessage="No records were returned." /></div></div></div>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Meeting records could not be loaded.";
}
