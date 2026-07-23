import Link from "next/link";
import { buttonVariants } from "@/frontend/components/design-system/primitives/button";

// AIDEV-NOTE: Placeholder destination for dashboard drill-ins. Every "decorative"
// looking element must land somewhere that explains the production feature in
// concrete terms — never a dead click.
export interface PlaceholderCopy {
  title: string;
  summary: string;
  productionBehavior: string[];
}

export const REPORT_PLACEHOLDERS: Record<string, PlaceholderCopy> = {
  throughput: {
    title: "Meeting throughput report",
    summary: "This report will summarize completed records returned by the backend API.",
    productionBehavior: [
      "Chart signed records per month from the live archive API.",
      "Break down cycle time per lifecycle stage (AI analysis, review, PDF, signature).",
      "Export a board-ready PDF or CSV of the last 12 months.",
    ],
  },
  lifecycle: {
    title: "Lifecycle health report",
    summary: "The health gauge compares meetings on track against records stuck in a failure state.",
    productionBehavior: [
      "Alert officers when a record stays in a failure state longer than the agreed SLA.",
      "List the exact meetings behind each percentage so nothing hides in an average.",
      "Track recovery time trends after AI, PDF, signature, and archive failures.",
    ],
  },
};

export function PlaceholderScreen({ copy }: { copy: PlaceholderCopy }) {
  return (
    <div className="max-w-2xl">
      <div className="text-xs font-semibold tracking-wide text-secondary">Meeting records · Reporting preview</div>
      <h1 className="mt-0.5 text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{copy.summary}</p>
      <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-sm shadow-primary/5">
        <h2 className="text-base font-semibold">In production, this page would…</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {copy.productionBehavior.map((line) => <li key={line}>{line}</li>)}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Reporting will become available when the backend endpoints are implemented.</p>
      </div>
      <Link className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })} href="/app/dashboard">Back to dashboard</Link>
    </div>
  );
}
