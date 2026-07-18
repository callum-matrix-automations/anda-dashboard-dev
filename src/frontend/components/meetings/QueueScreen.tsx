"use client";

import { useMeetings } from "@/frontend/hooks/useApi";
import { MeetingTable } from "@/frontend/components/shared/MeetingTable";
import { LoadingState } from "@/frontend/components/shared/States";
import { BackendUnavailable } from "@/frontend/components/shared/BackendUnavailable";

const copy = {
  meetings: ["All meetings", "Browse meeting records returned by the backend API."],
  "needs-review": ["Needs review", "Meetings requiring an authorised review decision."],
  deferred: ["Deferred", "Meetings awaiting external information."],
  signing: ["Signing", "Meetings awaiting an authorised signature."],
  archive: ["Archive", "Completed signed meeting records."],
} as const;

export function QueueScreen({ queue }: { queue: string }) {
  const query = useMeetings(queue);
  const [title, description] = copy[queue as keyof typeof copy] ?? ["Meetings", "Meeting records"];
  const heading = <div><div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>{title}</li></ul></div><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm opacity-60">{description}</p></div>;

  if (query.isLoading) return <LoadingState label={`Loading ${title.toLowerCase()}`} />;
  if (query.isError) return <div className="grid gap-4">{heading}<BackendUnavailable resource={`${title} records`} /></div>;

  return <div className="grid gap-4">{heading}<div className="card border border-base-300 bg-base-200"><div className="card-body p-3 sm:p-4"><MeetingTable meetings={query.data ?? []} browseAll={queue === "meetings"} reviewAccess signerAccess emptyMessage="No records were returned." /></div></div></div>;
}
