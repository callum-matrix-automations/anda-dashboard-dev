"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useArchive } from "@/frontend/hooks/useApi";
import { EmptyState, ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { MEETING_CATEGORIES, type MeetingArchiveQuery } from "@/shared/contracts/meetingArchive";

const PAGE_SIZE = 10;
type ArchiveCategory = (typeof MEETING_CATEGORIES)[number];

export function ArchiveScreen() {
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [category, setCategory] = useState<ArchiveCategory | "">("");
  const [offset, setOffset] = useState(0);
  const deferredSearch = useDeferredValue(search.trim());
  const parsedYear = validYear(year);
  const filtersValid = !year || parsedYear !== null;
  const queryParameters: Partial<MeetingArchiveQuery> = {
    query: deferredSearch || undefined,
    year: parsedYear ?? undefined,
    category: category || undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const query = useArchive(queryParameters, filtersValid);
  const heading = (
    <div>
      <div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>Archive</li></ul></div>
      <h1 className="text-2xl font-semibold">Signed meeting archive</h1>
      <p className="text-sm opacity-60">Search immutable completed records and open their verified signed PDFs.</p>
    </div>
  );

  const updateSearch = (value: string) => { setSearch(value); setOffset(0); };
  const updateYear = (value: string) => { setYear(value); setOffset(0); };
  const updateCategory = (value: ArchiveCategory | "") => { setCategory(value); setOffset(0); };

  return (
    <div className="grid gap-4">
      {heading}
      <section className="card border border-base-300 bg-base-200" aria-label="Archive filters">
        <div className="card-body grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_14rem] sm:p-4">
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Topic search</span>
            <input className="input input-bordered w-full" type="search" maxLength={500} value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Minutes, motions, title or tags" />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Meeting year</span>
            <input className={`input input-bordered w-full ${year && parsedYear === null ? "input-error" : ""}`} type="number" min="1900" max="2200" value={year} onChange={(event) => updateYear(event.target.value)} placeholder="All years" />
          </label>
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Category</span>
            <select className="select select-bordered w-full" value={category} onChange={(event) => updateCategory(event.target.value as ArchiveCategory | "")}>
              <option value="">All categories</option>
              {MEETING_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {year && parsedYear === null && <p role="alert" className="px-4 pb-3 text-xs text-error">Enter a four-digit year between 1900 and 2200.</p>}
      </section>

      {filtersValid && query.isLoading && <LoadingState label="Loading signed meeting archive" />}
      {filtersValid && query.isError && <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} />}
      {filtersValid && query.data && query.data.items.length === 0 && (
        <EmptyState title="No signed records found" body="Try removing a filter or searching for a different topic." />
      )}
      {filtersValid && query.data && query.data.items.length > 0 && (
        <section className="card border border-base-300 bg-base-100">
          <div className="overflow-x-auto">
            <table className="table operational-table">
              <thead><tr><th>Meeting</th><th>Category</th><th>Signed</th><th><span className="sr-only">Action</span></th></tr></thead>
              <tbody>{query.data.items.map((item) => (
                <tr key={item.meetingId}>
                  <td><div className="font-medium">{item.title}</div><div className="text-xs opacity-55">{formatDate(item.meetingDate)} · completed {formatDateTime(item.completedAt)}</div>{item.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{item.tags.map((tag) => <span className="badge badge-outline badge-sm" key={tag}>{tag}</span>)}</div>}</td>
                  <td>{item.category}</td>
                  <td className="whitespace-nowrap">{formatDateTime(item.signedAt)}</td>
                  <td><Link className="btn btn-outline btn-sm min-h-11 whitespace-nowrap" href={`/app/archive/${item.meetingId}`}>View signed record</Link></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 p-3 text-sm">
            <span className="opacity-60">Showing {offset + 1}–{Math.min(offset + query.data.items.length, query.data.total)} of {query.data.total}</span>
            <div className="join">
              <button type="button" className="btn join-item btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <button type="button" className="btn join-item btn-sm" disabled={offset + PAGE_SIZE >= query.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function validYear(value: string): number | null {
  if (!value) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The signed meeting archive is unavailable.";
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
