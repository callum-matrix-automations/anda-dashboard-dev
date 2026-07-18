import Link from "next/link";

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
      <div className="breadcrumbs text-xs"><ul><li>Meeting records</li><li>Reporting preview</li></ul></div>
      <h1 className="text-2xl font-semibold">{copy.title}</h1>
      <p className="mt-1 text-sm opacity-60">{copy.summary}</p>
      <div className="card mt-3 border border-base-300 bg-base-200">
        <div className="card-body compact-card">
          <h2 className="card-title text-base">In production, this page would…</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {copy.productionBehavior.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="text-xs opacity-60">Reporting will become available when the backend endpoints are implemented.</p>
        </div>
      </div>
      <Link className="btn btn-outline btn-sm mt-3 min-h-11 sm:min-h-9" href="/app/dashboard">Back to dashboard</Link>
    </div>
  );
}
