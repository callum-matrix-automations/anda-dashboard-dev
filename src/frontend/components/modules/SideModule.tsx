"use client";

import { useModuleRecords } from "@/frontend/hooks/useApi";
import type { ModuleName } from "@/shared/contracts/api";
import { LoadingState, EmptyState } from "@/frontend/components/shared/States";
import { BackendUnavailable } from "@/frontend/components/shared/BackendUnavailable";

const descriptions: Record<ModuleName, string> = {
  financials: "Budget, actuals, and reserve performance.",
  properties: "Portfolio occupancy and open work orders.",
  vendors: "Contracts, compliance, and annual spend.",
  contacts: "Resident enquiries received through the website.",
};

export function SideModule({ module }: { module: string }) {
  const name = module as ModuleName;
  const query = useModuleRecords(name);
  const title = module[0]!.toUpperCase() + module.slice(1);
  const heading = <div><div className="breadcrumbs text-xs"><ul><li>Association</li><li>{title}</li></ul></div><h1 className="text-2xl font-semibold">{title}</h1><p className="text-sm opacity-60">{descriptions[name]}</p></div>;
  if (query.isLoading) return <LoadingState label={`Loading ${module}`} />;
  if (query.isError) return <div className="grid gap-4">{heading}<BackendUnavailable resource={`${title} records`} /></div>;
  const rows = query.data as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return <div className="grid gap-4">{heading}<EmptyState title="No records" body="The API returned no records." /></div>;
  const columns = Object.keys(rows[0]!).filter((key) => key !== "id").slice(0, 6);
  return <div className="grid gap-4">{heading}<div className="overflow-x-auto rounded-box border border-base-300 bg-base-200"><table className="table table-sm"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div></div>;
}
