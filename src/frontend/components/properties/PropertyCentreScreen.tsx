"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useProperties } from "@/frontend/hooks/useApi";
import { AddIcon } from "@/frontend/components/design-system/icons";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Label } from "@/frontend/components/design-system/primitives/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/design-system/primitives/table";
import { EmptyState, ErrorState, LoadingState } from "@/frontend/components/shared/States";
import type { PropertyListStatus, PropertyType } from "@/shared/contracts/property";
import { PROPERTY_TYPE_LABELS, formatDateTime, nativeSelectClass, propertySummary } from "./propertyPresentation";

const PAGE_SIZE = 25;

export function PropertyCentreScreen() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<PropertyType | "">("");
  const [status, setStatus] = useState<PropertyListStatus>("active");
  const [offset, setOffset] = useState(0);
  const query = useProperties({ q: search, type: type || null, status, limit: PAGE_SIZE, offset });

  const changeSearch = (value: string) => { setSearch(value); setOffset(0); };
  const changeType = (value: PropertyType | "") => { setType(value); setOffset(0); };
  const changeStatus = (value: PropertyListStatus) => { setStatus(value); setOffset(0); };

  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-secondary">Association · Property Centre</div>
          <h1 className="mt-0.5 text-2xl font-semibold">Owned-property inventory</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">A concise internal reference for every home, multifamily property and vacant parcel ANDA owns.</p>
        </div>
        <Link href="/app/properties/new" className={buttonVariants({ size: "lg" })}>
          <AddIcon aria-hidden /> Add property
        </Link>
      </header>

      {query.data && (
        <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6" aria-label="Property inventory totals">
          <InventoryStat label="Active properties" value={query.data.summary.activeTotal} />
          <InventoryStat label="Single-family" value={query.data.summary.singleFamily} />
          <InventoryStat label="Multifamily" value={query.data.summary.multifamily} />
          <InventoryStat label="Vacant land" value={query.data.summary.vacantLand} />
          <InventoryStat label="Tracked units" value={query.data.summary.totalUnits} />
          <InventoryStat label="Archived" value={query.data.summary.archivedTotal} />
        </section>
      )}

      <section className="rounded-xl border border-border bg-card" aria-label="Property filters">
        <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_13rem_11rem] sm:p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="property-search" className="text-xs">Address or parcel</Label>
            <Input id="property-search" className="h-10" type="search" maxLength={200} value={search} onChange={(event) => changeSearch(event.target.value)} placeholder="Search the property inventory" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="property-type" className="text-xs">Property type</Label>
            <select id="property-type" className={nativeSelectClass} value={type} onChange={(event) => changeType(event.target.value as PropertyType | "")}>
              <option value="">All property types</option>
              {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="property-status" className="text-xs">Inventory</Label>
            <select id="property-status" className={nativeSelectClass} value={status} onChange={(event) => changeStatus(event.target.value as PropertyListStatus)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All records</option>
            </select>
          </div>
        </div>
      </section>

      {query.isLoading && <LoadingState label="Loading property inventory" />}
      {query.isError && <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title={status === "archived" ? "No archived properties" : "No properties found"}
          body={search || type ? "Try removing a filter or searching for another address." : "Add ANDA's first property to begin the inventory."}
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <div className="grid gap-2 md:hidden">
            {query.data.items.map((property) => (
              <Link key={property.id} href={`/app/properties/${property.id}`} className="flex gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-secondary/40 hover:bg-secondary/5">
                <PropertyThumbnail property={property} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <strong className="truncate">{property.formattedAddress}</strong>
                    {property.archivedAt && <Badge variant="outline">Archived</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{PROPERTY_TYPE_LABELS[property.details.type]}</p>
                  <p className="mt-1 text-sm">{propertySummary(property)}</p>
                </div>
              </Link>
            ))}
          </div>

          <section className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-sm shadow-primary/5 md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Property</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference details</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead><span className="sr-only">Action</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-3">
                        <PropertyThumbnail property={property} />
                        <div className="min-w-0">
                          <div className="font-medium">{property.formattedAddress}</div>
                          {property.archivedAt && <Badge className="mt-1" variant="outline">Archived</Badge>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{PROPERTY_TYPE_LABELS[property.details.type]}</TableCell>
                    <TableCell className="whitespace-normal text-sm text-muted-foreground">{propertySummary(property)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(property.updatedAt)}</TableCell>
                    <TableCell className="text-right"><Link className={buttonVariants({ size: "sm", variant: "outline" })} href={`/app/properties/${property.id}`}>View</Link></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Showing {offset + 1}–{Math.min(offset + query.data.items.length, query.data.total)} of {query.data.total}</span>
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
              <Button type="button" size="sm" variant="outline" disabled={offset + PAGE_SIZE >= query.data.total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function InventoryStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-border bg-card p-3"><div className="text-2xl font-semibold">{value.toLocaleString("en-US")}</div><div className="mt-0.5 text-xs text-muted-foreground">{label}</div></div>;
}

function PropertyThumbnail({ property }: { property: NonNullable<ReturnType<typeof useProperties>["data"]>["items"][number] }) {
  const image = property.images[0];
  return (
    <span className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-xl font-semibold text-muted-foreground">
      {image
        ? <Image unoptimized fill sizes="56px" className="object-cover" src={image.contentUrl} alt="" />
        : property.details.type === "VACANT_LAND" ? "L" : property.details.type === "MULTIFAMILY" ? "M" : "H"}
    </span>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The property inventory is unavailable.";
}
