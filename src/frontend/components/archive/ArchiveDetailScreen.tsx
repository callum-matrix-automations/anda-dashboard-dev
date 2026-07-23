"use client";

import Link from "next/link";
import { useArchiveDocumentAccess, useArchiveMeeting } from "@/frontend/hooks/useApi";
import { EmptyState, ErrorState, LoadingState } from "@/frontend/components/shared/States";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { MeetingReviewMinutesSchema } from "@/shared/contracts/meetingReview";

const outcomeLabel = {
  CARRIED: "Carried",
  FAILED: "Failed",
  TABLED: "Tabled",
  NOT_SECONDED: "Not seconded",
} as const;

export function ArchiveDetailScreen({ meetingId }: { meetingId: string }) {
  const query = useArchiveMeeting(meetingId);
  const access = useArchiveDocumentAccess();
  const heading = (
    <div>
      <div className="text-xs font-semibold tracking-wide text-secondary">
        <Link href="/app/archive" className="hover:underline">Archive</Link> · Signed record
      </div>
      <h1 className="mt-0.5 text-2xl font-semibold">Completed meeting record</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">This signed record is immutable.</p>
    </div>
  );

  if (query.isLoading) return <LoadingState label="Loading signed meeting record" />;
  if (query.isError) return <div className="grid gap-4">{heading}<ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} /></div>;
  const meeting = query.data;
  if (!meeting) return <div className="grid gap-4">{heading}<EmptyState title="Signed record not found" body="This meeting is not available in the completed archive." /></div>;

  const minutes = MeetingReviewMinutesSchema.safeParse(meeting.minutes);
  return (
    <div className="grid gap-4">
      {heading}
      <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm shadow-primary/5">
        <header className="border-b border-border p-4">
          <Badge variant="default">Completed</Badge>
          <h2 className="mt-2 text-2xl font-semibold">{meeting.title}</h2>
          <p className="text-sm text-muted-foreground">{meeting.category} · {formatDate(meeting.meetingDate)} · completed {formatDateTime(meeting.completedAt)}</p>
          {meeting.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{meeting.tags.map((tag) => <Badge variant="outline" key={tag}>{tag}</Badge>)}</div>}
        </header>

        <section className="grid gap-3 border-b border-border p-4 sm:grid-cols-3" aria-label="Signed document information">
          <ArchiveFact label="Signed" value={formatDateTime(meeting.signedAt)} />
          <ArchiveFact label="Document version" value={String(meeting.document.documentVersion)} />
          <ArchiveFact label="Signed PDF" value={`${meeting.document.pageCount} pages · ${formatBytes(meeting.document.sizeBytes)}`} />
          <div className="sm:col-span-3">
            <Button type="button" size="sm" loading={access.isPending} disabled={access.isPending} onClick={() => access.mutate(meeting.meetingId)}>
              {access.isPending ? "Preparing secure link..." : "Get signed PDF"}
            </Button>
            {access.isError && <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(access.error)}</p>}
            {access.data && (
              <div role="status" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-secondary/40 bg-secondary/10 p-3 text-sm">
                <span>Secure access is ready until {formatDateTime(access.data.expiresAt)}.</span>
                <a className={buttonVariants({ size: "sm" })} href={access.data.url} target="_blank" rel="noreferrer">Open signed PDF</a>
              </div>
            )}
          </div>
        </section>

        <section className="border-b border-border p-4" aria-labelledby="archive-minutes-title">
          <h3 id="archive-minutes-title" className="text-lg font-semibold">Approved minutes</h3>
          {minutes.success ? (
            <div className="mt-3 grid gap-5">
              <p>{minutes.data.summary}</p>
              {minutes.data.sections.map((section) => <div key={section.heading}><h4 className="font-semibold">{section.heading}</h4><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{section.content}</p></div>)}
            </div>
          ) : <p className="mt-2 text-sm text-muted-foreground">The approved minutes are available in the signed PDF.</p>}
        </section>

        <section className="p-4" aria-labelledby="archive-motions-title">
          <h3 id="archive-motions-title" className="text-lg font-semibold">Motions</h3>
          {meeting.motions.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No motions were recorded.</p> : (
            <ul className="mt-3 grid gap-2">{meeting.motions.map((motion) => (
              <li className="rounded-lg border border-border p-3" key={motion.id}>
                <p>{motion.text ?? "Motion text was not recorded."}</p>
                <span className="mt-2 inline-block text-sm font-medium">{motion.outcome ? outcomeLabel[motion.outcome] : "Outcome not recorded"}</span>
              </li>
            ))}</ul>
          )}
        </section>
      </article>
    </div>
  );
}

function ArchiveFact({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The completed meeting record is unavailable.";
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.ceil(bytes / 1_000)} KB`;
}
