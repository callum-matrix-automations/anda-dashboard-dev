"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useMeetingSearch } from "@/frontend/hooks/useApi";
import { ErrorState } from "@/frontend/components/shared/States";
import { statusLabel, statusText } from "@/frontend/components/shared/meetingPresentation";

const MAX_QUERY_LENGTH = 200;

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const results = useMeetingSearch(deferredQuery);
  const meetings = results.data?.items ?? [];

  return (
    <div className="grid gap-4">
      <div><div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>Search</li></ul></div><h1 className="text-2xl font-semibold">Search</h1><p className="text-sm opacity-60">Search requests are sent to the backend API; records are not indexed in the browser.</p></div>
      <label className="form-control w-full sm:max-w-md"><span className="label-text mb-1 text-xs">Search meetings and records</span><input className="input input-bordered" type="search" value={query} maxLength={MAX_QUERY_LENGTH} onChange={(event) => setQuery(event.target.value)} placeholder="Meeting title, date, or content" /></label>
      {deferredQuery && results.isError && <ErrorState message={errorMessage(results.error)} retry={() => void results.refetch()} />}
      {deferredQuery && results.isLoading && <p role="status" className="text-sm opacity-60">Searching…</p>}
      {deferredQuery && results.data && meetings.length === 0 && <p role="status" className="text-sm opacity-60">No matching records were returned.</p>}
      {meetings.length > 0 && <ul className="grid gap-2">{meetings.map((meeting) => <li key={meeting.id} className="card border border-base-300 bg-base-200"><div className="card-body flex-row items-center justify-between p-3"><div><strong>{meeting.title}</strong><div className={`text-sm ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</div></div><Link className="btn btn-outline btn-sm" href={`/app/meetings/${meeting.id}`}>Open</Link></div></li>)}</ul>}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Search results could not be loaded.";
}
