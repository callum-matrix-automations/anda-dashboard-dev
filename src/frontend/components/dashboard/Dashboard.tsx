"use client";

import Link from "next/link";
import { useMeetings } from "@/frontend/hooks/useApi";
import { Skeleton } from "@/frontend/components/design-system/primitives/skeleton";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/frontend/components/design-system/primitives/alert";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { meetingHref } from "@/frontend/components/shared/meetingPresentation";
import { StatusBadge } from "@/frontend/components/shared/StatusBadge";
import { MdAssignment, MdAssignmentLate, MdAssignmentTurnedIn, MdFmdBad } from "react-icons/md";
import type { IconType } from "react-icons";
import type { MeetingApiSummary } from "@/shared/contracts/meetingApi";
import { ExceptionIcon, RetryIcon } from "@/frontend/components/design-system/icons";
import { ManualTranscriptUploadDialog } from "@/frontend/components/dashboard/ManualTranscriptUploadDialog";

// AIDEV-NOTE: Reference screen for the ANDA redesign. Data logic is unchanged from the
// DaisyUI original — it still reads useMeetings().data.{items,total,status}. What changed
// is presentation: source-owned metric cards + Phosphor icons + design-system states,
// so no DaisyUI classes remain here. Follow this pattern when migrating other screens.

type Tone = "primary" | "warning" | "success" | "destructive";

const toneRing: Record<Tone, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  destructive: "bg-destructive/10 text-destructive",
};

export function Dashboard() {
  const query = useMeetings();

  if (query.isLoading) {
    return (
      <div className="flex min-h-full flex-col gap-4">
        <DashboardHeading />
        <MetricGridSkeleton />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex min-h-full flex-col gap-4">
        <DashboardHeading />
        <Alert variant="destructive">
          <ExceptionIcon />
          <AlertTitle>Dashboard data could not be loaded</AlertTitle>
          <AlertDescription>{errorMessage(query.error)}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" loading={query.isFetching} onClick={() => void query.refetch()}>
              {!query.isFetching && <RetryIcon />}
              {query.isFetching ? "Trying again..." : "Try again"}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }

  const meetings = query.data?.items ?? [];
  const completed = meetings.filter((meeting) => meeting.status === "COMPLETED").length;
  const pending = meetings.filter((meeting) => meeting.status === "PENDING_APPROVAL").length;
  const exceptions = meetings.filter((meeting) => meeting.status.endsWith("FAILED")).length;

  return (
    <div className="flex min-h-full flex-col gap-4">
      <DashboardHeading />
      <section className="grid flex-1 gap-4 sm:grid-cols-2 sm:grid-rows-2">
        <Metric title="Meeting records" value={query.data?.total ?? 0} href="/app/meetings" icon={MdAssignment} tone="primary" previews={meetings} />
        <Metric
          title="Pending approval"
          value={pending}
          href="/app/needs-review"
          icon={MdAssignmentLate}
          tone="warning"
          previews={meetings.filter((meeting) => meeting.status === "PENDING_APPROVAL")}
        />
        <Metric
          title="Completed"
          value={completed}
          href="/app/archive"
          icon={MdAssignmentTurnedIn}
          tone="success"
          previews={meetings.filter((meeting) => meeting.status === "COMPLETED")}
        />
        <Metric
          title="Exceptions"
          value={exceptions}
          href="/app/meetings"
          icon={MdFmdBad}
          tone="destructive"
          previews={meetings.filter((meeting) => meeting.status.endsWith("FAILED"))}
        />
      </section>
    </div>
  );
}

function DashboardHeading() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[.7rem] font-semibold tracking-wide text-secondary">Meeting access · Overview</div>
        <h1 className="mt-0.5 text-[1.7rem] font-semibold text-foreground">Meeting operations</h1>
        <p className="mt-0.5 text-[.86rem] text-muted-foreground">Live meeting workflow status from the ANDA backend.</p>
      </div>
      <ManualTranscriptUploadDialog />
    </div>
  );
}

function Metric({
  title,
  value,
  href,
  icon: Icon,
  tone,
  previews,
}: {
  title: string;
  value: number;
  href: string;
  icon: IconType;
  tone: Tone;
  previews: MeetingApiSummary[];
}) {
  const previewItems = previews.slice(0, 3);

  return (
    <article className="flex min-h-64 flex-col rounded-xl border border-border bg-card p-5 shadow-sm shadow-primary/5">
      <span className="flex items-start justify-between gap-4">
        <span className="flex min-w-0 items-center gap-3">
          <span className={`grid size-12 shrink-0 place-items-center rounded-lg ${toneRing[tone]}`}>
            <Icon size={24} aria-hidden />
          </span>
          <span className="block truncate text-sm font-medium text-muted-foreground">{title}</span>
        </span>
        <strong className="tabular-nums block text-4xl font-semibold leading-none text-foreground">{value}</strong>
      </span>
      <div className="mt-5 flex flex-1 flex-col border-t border-border/70 pt-4">
        <span className="mb-2 block text-[.68rem] font-semibold uppercase tracking-[.12em] text-muted-foreground">
          Recent records
        </span>
        {previewItems.length > 0 ? <MeetingPreviews meetings={previewItems} /> : <EmptyPreview />}
        <Link href={href} className={buttonVariants({ variant: "outline", size: "lg", className: "mt-auto w-full" })}>
          View {title.toLowerCase()}
        </Link>
      </div>
    </article>
  );
}

function MetricGridSkeleton() {
  return (
    <section className="grid flex-1 gap-4 sm:grid-cols-2 sm:grid-rows-2" aria-hidden>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex min-h-64 flex-col rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Skeleton className="size-12 rounded-lg" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-9 w-12" />
          </div>
          <div className="mt-5 grid gap-4 border-t border-border/70 pt-4">
            <Skeleton className="h-3 w-20" />
            <EmptyPreview />
          </div>
        </div>
      ))}
    </section>
  );
}

function MeetingPreviews({ meetings }: { meetings: MeetingApiSummary[] }) {
  return (
    <ul className="divide-y divide-border/65">
      {meetings.map((meeting) => (
        <li key={meeting.id}>
          <Link
            href={meetingHref(meeting.status, meeting.id)}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{meeting.title}</span>
              <StatusBadge status={meeting.status} className="mt-1" />
            </span>
            <time className="whitespace-nowrap text-xs text-muted-foreground" dateTime={meeting.meetingDate}>
              {formatDate(meeting.meetingDate)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyPreview() {
  return (
    <div className="grid gap-3" aria-hidden>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-4 border-b border-border/45 pb-3 last:border-0">
          <div className="grid gap-1.5">
            <Skeleton className={`h-3 animate-none ${index === 1 ? "w-3/4" : "w-full"}`} />
            <Skeleton className="h-2.5 w-1/3 animate-none opacity-70" />
          </div>
          <Skeleton className="h-3 w-full animate-none opacity-70" />
        </div>
      ))}
    </div>
  );
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Dashboard data could not be loaded.";
}
