import type { PropertyDetail, PropertyType } from "@/shared/contracts/property";

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  SINGLE_FAMILY: "Single-family",
  MULTIFAMILY: "Multifamily",
  VACANT_LAND: "Vacant land",
};

export const nativeSelectClass =
  "h-10 w-full rounded-md border border-input bg-input/20 px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 dark:bg-input/30";

export function propertySummary(property: PropertyDetail) {
  if (property.details.type === "SINGLE_FAMILY") {
    return joinFacts([
      countLabel(property.details.bedrooms, "bed"),
      countLabel(property.details.bathrooms, "bath"),
      property.details.squareFeet ? `${property.details.squareFeet.toLocaleString("en-US")} sq ft` : null,
    ]);
  }
  if (property.details.type === "MULTIFAMILY") {
    return joinFacts([
      property.details.subtype,
      countLabel(property.details.units.length, "unit"),
    ]);
  }
  return joinFacts([
    property.details.lotSize
      ? `${formatNumber(property.details.lotSize.value)} ${property.details.lotSize.unit === "ACRES" ? "acres" : "sq ft"}`
      : null,
    property.details.zoning ? `Zoning ${property.details.zoning}` : null,
  ]);
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatBytes(bytes: number) {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.ceil(bytes / 1_000)} KB`;
}

function countLabel(value: number | null, singular: string) {
  if (value === null) return null;
  return `${formatNumber(value)} ${singular}${value === 1 ? "" : "s"}`;
}

function joinFacts(values: Array<string | null>) {
  const available = values.filter((value): value is string => Boolean(value));
  return available.length ? available.join(" · ") : "Details not recorded";
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
