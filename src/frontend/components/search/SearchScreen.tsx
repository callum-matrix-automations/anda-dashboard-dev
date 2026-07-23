"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useMeetingSearch } from "@/frontend/hooks/useApi";
import { ErrorState } from "@/frontend/components/shared/States";
import { StatusBadge } from "@/frontend/components/shared/StatusBadge";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Label } from "@/frontend/components/design-system/primitives/label";
import { buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { meetingHref } from "@/frontend/components/shared/meetingPresentation";

const MAX_QUERY_LENGTH = 200;

export function SearchScreen() {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const results = useMeetingSearch(deferredQuery);
  const meetings = results.data?.items ?? [];

  return (
    <div className="grid gap-4">
      <div>
        <div className="text-[.7rem] font-semibold tracking-wide text-secondary">Meeting records · Search</div>
        <h1 className="mt-0.5 text-2xl font-semibold">Search</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Search requests are sent to the backend API; records are not indexed in the browser.</p>
      </div>
      <div className="grid w-full gap-1.5 sm:max-w-md">
        <Label htmlFor="meeting-search" className="text-xs">Search meetings and records</Label>
        <Input
          id="meeting-search"
          className="h-10"
          type="search"
          value={query}
          maxLength={MAX_QUERY_LENGTH}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Meeting title, date, or content"
        />
      </div>
      {deferredQuery && results.isError && <ErrorState message={errorMessage(results.error)} retry={() => void results.refetch()} retrying={results.isFetching} />}
      {deferredQuery && results.isLoading && <p role="status" className="text-sm text-muted-foreground">Searching…</p>}
      {deferredQuery && results.data && meetings.length === 0 && <p role="status" className="text-sm text-muted-foreground">No matching records were returned.</p>}
      {meetings.length > 0 && (
        <ul className="grid gap-2">
          {meetings.map((meeting) => (
            <li key={meeting.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
              <div className="min-w-0">
                <strong className="block truncate">{meeting.title}</strong>
                <div className="mt-1"><StatusBadge status={meeting.status} /></div>
              </div>
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={meetingHref(meeting.status, meeting.id)}>Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Search results could not be loaded.";
}
