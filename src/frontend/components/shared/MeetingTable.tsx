"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { MeetingApiSummary } from "@/shared/contracts/meetingApi";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/design-system/primitives/table";
import { buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { StatusBadge } from "@/frontend/components/shared/StatusBadge";
import { statusTone } from "./meetingPresentation";
import { meetingActionFor } from "./meetingPresentation";
import { CaretUpDownIcon, CaretUpIcon, CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@/frontend/components/design-system/lib/utils";

// AIDEV-NOTE: Headless TanStack Table for the operational queues. The markup and ANDA
// styling stay under our control (design-system Table primitive); TanStack only supplies
// sorting/model. The action routing (meetingActionFor) and responsive mobile card list are
// unchanged from the DaisyUI original so queue workflows keep working.

function meetingDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Sort statuses by their operational severity so "needs attention" surfaces near the top.
const STATUS_ORDER: Record<string, number> = {
  destructive: 0,
  warning: 1,
  secondary: 1,
  outline: 2,
  success: 3,
  default: 3,
};

export function MeetingTable({
  meetings,
  browseAll = false,
  reviewAccess = false,
  signerAccess = false,
  emptyMessage = "Nothing needs attention here.",
}: {
  meetings: MeetingApiSummary[];
  browseAll?: boolean;
  reviewAccess?: boolean;
  signerAccess?: boolean;
  emptyMessage?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const router = useRouter();

  const columns = useMemo<ColumnDef<MeetingApiSummary>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Meeting",
        cell: ({ row }) => (
          <div>
            <div className="font-medium text-foreground">{row.original.title}</div>
            <div className="text-xs text-muted-foreground">{row.original.category}</div>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        sortingFn: (a, b) =>
          (STATUS_ORDER[statusTone[a.original.status]] ?? 9) - (STATUS_ORDER[statusTone[b.original.status]] ?? 9),
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: "meetingDate",
        header: "Date",
        cell: ({ row }) => <span className="tabular-nums">{meetingDate(row.original.meetingDate)}</span>,
      },
      {
        id: "action",
        header: () => <span className="sr-only">Action</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const action = meetingActionFor(row.original.status, row.original.id, { browseAll, reviewAccess, signerAccess });
          return (
            <Link
              aria-label={`${action.label} for ${row.original.title}`}
              href={action.href}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }), "whitespace-nowrap")}
            >
              {action.label}
            </Link>
          );
        },
      },
    ],
    [browseAll, reviewAccess, signerAccess],
  );

  const table = useReactTable({
    data: meetings,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (!meetings.length) {
    return <div className="py-12 text-center text-sm text-muted-foreground">{emptyMessage}</div>;
  }

  return (
    <>
      {/* Mobile: card list */}
      <ul aria-label="Meeting records" className="grid gap-2 sm:hidden">
        {table.getRowModel().rows.map((row) => {
          const meeting = row.original;
          const action = meetingActionFor(meeting.status, meeting.id, { browseAll, reviewAccess, signerAccess });
          return (
            <li
              key={meeting.id}
              role={browseAll ? "link" : undefined}
              tabIndex={browseAll ? 0 : undefined}
              aria-label={browseAll ? `View ${meeting.title}` : undefined}
              className={cn(
                "rounded-lg border border-border bg-card p-3",
                browseAll && "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              )}
              onClick={browseAll ? (event) => {
                if (!isInteractiveTarget(event.target)) router.push(action.href);
              } : undefined}
              onKeyDown={browseAll ? (event) => {
                if (event.key === "Enter" && event.target === event.currentTarget) router.push(action.href);
              } : undefined}
            >
              <div className="font-medium">{meeting.title}</div>
              <div className="text-xs text-muted-foreground">{meeting.category}</div>
              <div className="my-3 flex items-center justify-between gap-2">
                <StatusBadge status={meeting.status} />
                <time dateTime={meeting.meetingDate} className="text-sm text-muted-foreground">{meetingDate(meeting.meetingDate)}</time>
              </div>
              <Link
                aria-label={`${action.label} for ${meeting.title}`}
                href={action.href}
                className={cn(buttonVariants({ size: "lg" }), "w-full")}
              >
                {action.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Desktop: sortable table */}
      <div className="hidden sm:block">
        <Table className="min-w-[34rem]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} className="text-[.72rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={header.column.getToggleSortingHandler()}
                          aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <SortIcon direction={sorted} />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const meeting = row.original;
              const action = meetingActionFor(meeting.status, meeting.id, { browseAll, reviewAccess, signerAccess });
              return (
                <TableRow
                  key={row.id}
                  role={browseAll ? "link" : undefined}
                  tabIndex={browseAll ? 0 : undefined}
                  aria-label={browseAll ? `View ${meeting.title}` : undefined}
                  className={cn(
                    browseAll && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                  )}
                  onClick={browseAll ? (event) => {
                    if (!isInteractiveTarget(event.target)) router.push(action.href);
                  } : undefined}
                  onKeyDown={browseAll ? (event) => {
                    if (event.key === "Enter" && event.target === event.currentTarget) router.push(action.href);
                  } : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(cell.column.id === "action" && "text-right")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea, [role='button']"));
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") return <CaretUpIcon aria-hidden className="size-3" />;
  if (direction === "desc") return <CaretDownIcon aria-hidden className="size-3" />;
  return <CaretUpDownIcon aria-hidden className="size-3 opacity-40" />;
}
