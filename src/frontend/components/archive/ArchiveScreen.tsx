"use client";

import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { useArchive } from "@/frontend/hooks/useApi";
import { EmptyState, ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Label } from "@/frontend/components/design-system/primitives/label";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/design-system/primitives/table";
import { MEETING_CATEGORIES, type MeetingArchiveQuery } from "@/shared/contracts/meetingArchive";

const PAGE_SIZE = 10;
type ArchiveCategory = (typeof MEETING_CATEGORIES)[number];

// AIDEV-NOTE: The Category filter stays a native <select> so `user.selectOptions` in the
// archive tests keeps working; it is restyled to match the Input primitive rather than
// swapped for the Base UI Select listbox.
const nativeSelectClass =
  "h-10 w-full rounded-md border border-input bg-input/20 px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30";

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
      <div className="text-[.7rem] font-semibold tracking-wide text-secondary">Meeting records · Archive</div>
      <h1 className="mt-0.5 text-2xl font-semibold">Signed meeting archive</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Search immutable completed records and open their verified signed PDFs.</p>
    </div>
  );

  const updateSearch = (value: string) => { setSearch(value); setOffset(0); };
  const updateYear = (value: string) => { setYear(value); setOffset(0); };
  const updateCategory = (value: ArchiveCategory | "") => { setCategory(value); setOffset(0); };
  const yearInvalid = Boolean(year) && parsedYear === null;

  return (
    <div className="grid gap-4">
      {heading}
      <section className="rounded-xl border border-border bg-card" aria-label="Archive filters">
        <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_14rem] sm:p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="archive-search" className="text-xs">Topic search</Label>
            <Input id="archive-search" className="h-10" type="search" maxLength={500} value={search} onChange={(event) => updateSearch(event.target.value)} placeholder="Minutes, motions, title or tags" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="archive-year" className="text-xs">Meeting year</Label>
            <Input id="archive-year" className="h-10" type="number" min="1900" max="2200" aria-invalid={yearInvalid} value={year} onChange={(event) => updateYear(event.target.value)} placeholder="All years" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="archive-category" className="text-xs">Category</Label>
            <select id="archive-category" className={nativeSelectClass} value={category} onChange={(event) => updateCategory(event.target.value as ArchiveCategory | "")}>
              <option value="">All categories</option>
              {MEETING_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>
        {yearInvalid && <p role="alert" className="px-4 pb-3 text-xs text-destructive">Enter a four-digit year between 1900 and 2200.</p>}
      </section>

      {filtersValid && query.isLoading && <LoadingState label="Loading signed meeting archive" />}
      {filtersValid && query.isError && <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} />}
      {filtersValid && query.data && query.data.items.length === 0 && (
        <EmptyState title="No signed records found" body="Try removing a filter or searching for a different topic." />
      )}
      {filtersValid && query.data && query.data.items.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm shadow-primary/5">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-[.72rem] font-semibold tracking-wide text-muted-foreground uppercase">Meeting</TableHead>
                <TableHead className="text-[.72rem] font-semibold tracking-wide text-muted-foreground uppercase">Category</TableHead>
                <TableHead className="text-[.72rem] font-semibold tracking-wide text-muted-foreground uppercase">Signed</TableHead>
                <TableHead><span className="sr-only">Action</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((item) => (
                <TableRow key={item.meetingId}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(item.meetingDate)} · completed {formatDateTime(item.completedAt)}</div>
                    {item.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">{item.tags.map((tag) => <Badge variant="outline" key={tag}>{tag}</Badge>)}</div>
                    )}
                  </TableCell>
                  <TableCell>{item.category}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(item.signedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Link className={buttonVariants({ size: "sm", variant: "outline", className: "whitespace-nowrap" })} href={`/app/archive/${item.meetingId}`}>View signed record</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-3 text-sm">
            <span className="text-muted-foreground">Showing {offset + 1}–{Math.min(offset + query.data.items.length, query.data.total)} of {query.data.total}</span>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
              <Button type="button" size="sm" variant="outline" disabled={offset + PAGE_SIZE >= query.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
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
