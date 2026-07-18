"use client";

import Link from "next/link";
import { useMeetings } from "@/frontend/hooks/useApi";
import { LoadingState } from "@/frontend/components/shared/States";
import { BackendUnavailable } from "@/frontend/components/shared/BackendUnavailable";

export function Dashboard() {
  const query = useMeetings();
  if (query.isLoading) return <LoadingState label="Loading dashboard" />;
  if (query.isError) return <div className="grid gap-4"><DashboardHeading /><BackendUnavailable resource="Dashboard data" /></div>;

  const meetings = query.data ?? [];
  const completed = meetings.filter((meeting) => meeting.status === "COMPLETED").length;
  const pending = meetings.filter((meeting) => meeting.status === "PENDING_APPROVAL").length;
  const exceptions = meetings.filter((meeting) => meeting.status.endsWith("FAILED")).length;

  return (
    <div className="grid gap-4">
      <DashboardHeading />
      <section className="stats stats-vertical border border-base-300 bg-base-200 shadow-none md:stats-horizontal">
        <Metric title="Meeting records" value={meetings.length} href="/app/meetings" />
        <Metric title="Pending approval" value={pending} href="/app/needs-review" />
        <Metric title="Completed" value={completed} href="/app/archive" />
        <Metric title="Exceptions" value={exceptions} href="/app/meetings" />
      </section>
    </div>
  );
}

function DashboardHeading() {
  return <div><div className="breadcrumbs text-xs"><ul><li>Meeting access</li><li>Overview</li></ul></div><h1 className="text-2xl font-semibold">Meeting operations</h1><p className="mt-1 text-sm opacity-60">Live values will be supplied by the backend API.</p></div>;
}

function Metric({ title, value, href }: { title: string; value: number; href: string }) {
  return <Link className="stat transition-colors hover:bg-base-300" href={href}><span className="stat-title">{title}</span><strong className="stat-value text-3xl">{value}</strong></Link>;
}
