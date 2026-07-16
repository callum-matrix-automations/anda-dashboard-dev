"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { ErrorState, LoadingState } from "@/components/shared/States";
import { meetingActionFor, statusLabel, statusText } from "@/components/shared/meetingPresentation";
import { canAccessMeetings, canReviewMeetings, canViewSignatureQueue } from "@/domain/permissions";
import { MAX_SEARCH_QUERY_LENGTH, searchMeetings, type SearchField } from "@/domain/search";

const fieldLabel: Record<SearchField, string> = {
  title: "Title",
  category: "Category",
  date: "Date",
  tags: "Tags",
  minutes: "Minutes",
  motions: "Motions",
  transcript: "Transcript",
};

export function SearchScreen() {
  const { repositories, viewer } = useWorkspace();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const meetingAccess = canAccessMeetings(viewer);
  const meetings = useQuery({ queryKey: ["meetings"], queryFn: () => repositories.meetings.list(), enabled: meetingAccess });
  if (meetings.isLoading) return <LoadingState label="Loading search" />;
  if (meetings.isError) return <ErrorState message="Meeting records could not be loaded." retry={() => void meetings.refetch()} />;
  if (meetings.data?.length === 0) {
    return (
      <div>
        <div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>Search</li></ul></div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <div role="status" aria-live="polite" className="mt-3 rounded-box border border-base-300 bg-base-200 p-6 text-center text-sm opacity-70">
          No fixture meeting records are available.
        </div>
      </div>
    );
  }

  const hits = searchMeetings(meetings.data ?? [], deferredQuery);
  const trimmed = deferredQuery.trim();
  const reviewAccess = canReviewMeetings(viewer);
  const signerAccess = canViewSignatureQueue(viewer);

  return (
    <div>
      <div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>Search</li></ul></div>
      <div className="mb-3">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm opacity-60">Search every meeting: titles, categories, dates, minutes, motions, and transcripts.</p>
      </div>
      <label className="form-control w-full sm:max-w-md">
        <span className="label-text mb-1 text-xs">Search meetings and records</span>
        <input
          className="input input-bordered"
          type="search"
          placeholder="e.g. reserve study, May Board, roof replacement"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          aria-label="Search meetings and records"
        />
      </label>
      <div className="mt-3" role="status" aria-live="polite">
        {trimmed && (
          <p className="text-sm opacity-70">
            {hits.length} result{hits.length === 1 ? "" : "s"} for “{trimmed}”
          </p>
        )}
      </div>
      {!trimmed && (
        <p className="mt-4 text-sm opacity-60">Type above to search. Results open the meeting record you are allowed to act on.</p>
      )}
      {trimmed && hits.length === 0 && (
        <div className="hero mt-3 min-h-40 rounded-box border border-base-300 bg-base-200">
          <div className="hero-content text-center">
            <div>
              <h2 className="text-lg font-semibold">No meetings match</h2>
              <p className="mt-2 text-sm opacity-65">Try a title, category, motion, or transcript phrase — for example “reserve study”.</p>
            </div>
          </div>
        </div>
      )}
      {hits.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {hits.map(({ meeting, matchedIn }) => {
            const action = meetingActionFor(meeting.status, meeting.id, { reviewAccess, signerAccess });
            return <li key={meeting.id} className="card border border-base-300 bg-base-200">
              <div className="card-body flex-col items-stretch gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm">{meeting.title}</strong>
                    <span className={`text-sm font-medium ${statusText[meeting.status]}`}>{statusLabel[meeting.status]}</span>
                  </div>
                  <div className="mt-1 text-xs opacity-60">
                    {meeting.category} · {meeting.date} · matched in {matchedIn.map((field) => fieldLabel[field]).join(", ")}
                  </div>
                </div>
                <Link className="btn btn-outline min-h-11 w-full sm:w-auto" href={action.href} aria-label={`${action.label} for ${meeting.title}`}>
                  {action.label}
                </Link>
              </div>
            </li>;
          })}
        </ul>
      )}
    </div>
  );
}
