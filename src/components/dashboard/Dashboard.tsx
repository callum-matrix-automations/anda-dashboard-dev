"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { MeetingTable } from "@/components/shared/MeetingTable";
import { ErrorState, LoadingState } from "@/components/shared/States";
import { canReviewMeetings, canViewSignatureQueue } from "@/domain/permissions";
import type { Meeting } from "@/domain/types";

function monthlyThroughput(meetings: Meeting[]) {
  const completed = meetings.filter((meeting) => meeting.status === "COMPLETED");
  const completionTimestamp = (meeting: Meeting) => meeting.archivedAt ?? meeting.signedAt ?? meeting.date;
  // Anchor to the fixture snapshot, not the most recent completion, so current zero months remain visible.
  const latest = meetings.map((meeting) => meeting.date).sort().at(-1) ?? new Date().toISOString();
  const anchor = new Date(`${latest.slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - (11 - offset), 1));
    const key = date.toISOString().slice(0, 7);
    return {
      key,
      label: new Intl.DateTimeFormat("en", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date),
      count: completed.filter((meeting) => completionTimestamp(meeting).startsWith(key)).length,
    };
  });
}

export function Dashboard() {
  const { repositories, viewer } = useWorkspace();
  const query = useQuery({ queryKey: ["meetings"], queryFn: () => repositories.meetings.list() });
  if (query.isLoading) return <LoadingState label="Loading dashboard" />;
  if (query.isError) return <ErrorState message="Dashboard data could not be loaded." retry={() => void query.refetch()} />;

  const meetings = query.data ?? [];
  const pending = meetings.filter((meeting) => meeting.status === "PENDING_APPROVAL" && !meeting.deferredAt).length;
  const failed = meetings.filter((meeting) => meeting.status.endsWith("FAILED")).length;
  const signatureAndArchive = meetings.filter((meeting) => ["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED"].includes(meeting.status)).length;
  const completed = meetings.filter((meeting) => meeting.status === "COMPLETED").length;
  const reviewAccess = canReviewMeetings(viewer);
  // AIDEV-NOTE: Every metric is a link, and each target must stay inside the viewer's
  // authorized routes — read-only users always land on the browsable meeting list.
  const reviewHref = reviewAccess ? "/app/needs-review" : "/app/meetings";
  const signingHref = canViewSignatureQueue(viewer) ? "/app/signing" : "/app/meetings";
  const bars = monthlyThroughput(meetings);
  const throughputLabel = `Completed fixture records by archive month. ${bars.map((bar) => `${bar.label}: ${bar.count}`).join("; ")}`;
  const maxBar = Math.max(...bars.map((bar) => bar.count), 1);
  const healthy = meetings.length === 0 ? 0 : Math.round(((meetings.length - failed) / meetings.length) * 100);

  return (
    <div className="dashboard-grid">
      <div className="flex items-end justify-between">
        <div>
          <div className="breadcrumbs text-xs"><ul><li>Meeting access</li><li>Overview</li></ul></div>
          <h1 className="text-2xl font-semibold">Good morning, {viewer.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm opacity-60">ANDA meeting operations at a glance.</p>
          <p className="mt-1 text-xs opacity-60">All values come from local demo fixtures; no live services or durable archive are connected.</p>
        </div>
        <Link href={reviewAccess ? "/app/needs-review" : "/app/meetings"} className="btn btn-primary btn-sm hidden sm:inline-flex">
          {reviewAccess ? "Review queue" : "Browse meetings"}
        </Link>
      </div>

      <section className="stats stats-vertical w-full border border-base-300 bg-base-200 shadow-none md:stats-horizontal">
        <Metric title="Open meetings" value={meetings.length - completed} detail="Across the lifecycle" href="/app/meetings" />
        <Metric title="Pending approval" value={pending} detail="Meeting status" tone="text-warning" href={reviewHref} />
        <Metric title="Signature and archive queue" value={signatureAndArchive} detail="Meeting status" href={signingHref} />
        <Metric title="Exceptions" value={failed} detail="All failure states" tone="text-error" href="/app/meetings" />
      </section>

      <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
        <section className="card border border-base-300 bg-base-200">
          <div className="card-body compact-card">
            <div className="flex justify-between">
              <div><h2 className="card-title text-base">Meeting throughput</h2><p className="text-xs opacity-55">Completed records, last 12 months</p></div>
              <Link className="btn btn-outline btn-xs" href="/app/archive">{completed} archived <span aria-hidden>→</span></Link>
            </div>
            <div className="flex h-40 items-end gap-2 pt-3" role="img" aria-label={throughputLabel}>
              {bars.map((bar) => <div aria-hidden className="chart-bar flex-1" style={{ height: bar.count === 0 ? "2px" : `${Math.max((bar.count / maxBar) * 100, 8)}%` }} key={bar.key} />)}
            </div>
            <div aria-hidden className="flex justify-between text-[0.65rem] opacity-60">
              <span>{bars[0]?.label}</span><span>{bars[5]?.label}</span><span>{bars.at(-1)?.label}</span>
            </div>
            <div className="grid grid-cols-3 border-t border-base-300 pt-2.5 text-xs">
              <div><strong className="block text-base">{meetings.length}</strong>Records</div>
              <div><strong className="block text-base">{completed}</strong>Completed</div>
              <div><strong className="block text-base">{healthy}%</strong>Without exceptions</div>
            </div>
            <Link className="link text-xs" href="/app/reports/throughput">How throughput is measured</Link>
          </div>
        </section>
        <section className="card border border-base-300 bg-base-200">
          <div className="card-body compact-card">
            <h2 className="card-title text-base">Lifecycle health</h2>
            <p className="text-xs opacity-55">Current meeting pipeline</p>
            <div className="radial-progress mx-auto my-2 text-primary" style={{ "--value": healthy } as React.CSSProperties} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={healthy} aria-label={`${healthy} percent without exceptions`}>{healthy}%</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span>On track</span><strong>{meetings.length - failed}</strong></div>
              <progress aria-label="On-track fixture records" className="progress progress-success" value={meetings.length - failed} max={Math.max(meetings.length, 1)} />
              <div className="flex justify-between"><span>Exceptions</span><strong>{failed}</strong></div>
              <progress aria-label="Exception fixture records" className="progress progress-error" value={failed} max={Math.max(meetings.length, 1)} />
            </div>
            <Link className="link text-xs" href="/app/reports/lifecycle">How lifecycle health is measured</Link>
          </div>
        </section>
      </div>

      <section className="card border border-base-300 bg-base-200">
        <div className="card-body compact-card">
          <div className="flex items-center justify-between">
            <h2 className="card-title text-base">Meeting pipeline</h2>
            <Link className="link text-xs" href="/app/meetings">View all</Link>
          </div>
          <MeetingTable
            meetings={meetings.filter((meeting) => meeting.status !== "COMPLETED").slice(0, 5)}
            browseAll={!reviewAccess}
            reviewAccess={reviewAccess}
            signerAccess={canViewSignatureQueue(viewer)}
          />
        </div>
      </section>
    </div>
  );
}

function Metric({ title, value, detail, href, tone = "" }: { title: string; value: number; detail: string; href: string; tone?: string }) {
  // AIDEV-NOTE: Metrics are navigation, not decoration — the whole stat is one link.
  return (
    <Link href={href} className="stat compact-stat group border border-base-300 bg-base-100 transition-colors hover:border-base-content hover:bg-base-300 focus-visible:border-base-content">
      <div className="stat-title underline decoration-base-content/40 underline-offset-4">{title}</div>
      <div className={`stat-value text-2xl ${tone}`}>{value}</div>
      <div className="stat-desc flex items-center justify-between gap-2"><span>{detail}</span><span aria-hidden className="font-bold opacity-70 group-hover:opacity-100">View →</span></div>
    </Link>
  );
}
