"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useArchiveProperty, useProperty, useRestoreProperty } from "@/frontend/hooks/useApi";
import { ArchivePropertyIcon, EditIcon, RestoreIcon } from "@/frontend/components/design-system/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/frontend/components/design-system/primitives/alert-dialog";
import { Badge } from "@/frontend/components/design-system/primitives/badge";
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/frontend/components/design-system/primitives/table";
import { EmptyState, ErrorState, LoadingState } from "@/frontend/components/shared/States";
import type { PropertyDetail } from "@/shared/contracts/property";
import { PropertyImageGallery } from "./PropertyImageGallery";
import { PROPERTY_TYPE_LABELS, formatDateTime, propertySummary } from "./propertyPresentation";

export function PropertyDetailScreen({ propertyId }: { propertyId: string }) {
  const query = useProperty(propertyId);
  const archive = useArchiveProperty();
  const restore = useRestoreProperty();
  const [confirmArchive, setConfirmArchive] = useState(false);

  if (query.isLoading) return <LoadingState label="Loading property record" />;
  if (query.isError) return <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} />;
  const property = query.data;
  if (!property) return <EmptyState title="Property not found" body="This property record is not available." />;

  const changeArchiveState = async () => {
    try {
      if (property.archivedAt) {
        await restore.mutateAsync({ propertyId: property.id, expectedVersion: property.version });
        toast.success("Property restored to the active inventory.");
      } else {
        await archive.mutateAsync({ propertyId: property.id, expectedVersion: property.version });
        toast.success("Property archived.");
      }
      setConfirmArchive(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const mutationPending = archive.isPending || restore.isPending;
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-semibold tracking-wide text-secondary"><Link href="/app/properties" className="hover:underline">Property Centre</Link> · Property record</div>
          <div className="mt-1 flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">{property.formattedAddress}</h1>{property.archivedAt && <Badge variant="outline">Archived</Badge>}</div>
          <p className="mt-1 text-sm text-muted-foreground">{PROPERTY_TYPE_LABELS[property.details.type]} · {propertySummary(property)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!property.archivedAt && <Link href={`/app/properties/${property.id}/edit`} className={buttonVariants({ variant: "outline" })}><EditIcon aria-hidden /> Edit property</Link>}
          <Button type="button" variant={property.archivedAt ? "outline" : "destructive"} onClick={() => setConfirmArchive(true)}>
            {property.archivedAt ? <RestoreIcon aria-hidden /> : <ArchivePropertyIcon aria-hidden />}
            {property.archivedAt ? "Restore" : "Archive"}
          </Button>
        </div>
      </header>

      {property.archivedAt && (
        <div className="rounded-xl border border-warning/35 bg-warning/8 p-3 text-sm" role="status">
          This property was archived on {formatDateTime(property.archivedAt)}. Its units, notes and images remain intact.
        </div>
      )}

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,.6fr)]">
        <div>
          <h2 className="text-lg font-semibold">Property details</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Fact label="Type" value={PROPERTY_TYPE_LABELS[property.details.type]} />
            <Fact label="City and state" value={`${property.address.city}, ${property.address.state}`} />
            <Fact label="ZIP code" value={property.address.postalCode ?? "Not recorded"} />
            {property.address.parcelReference && <Fact label="Parcel reference" value={property.address.parcelReference} />}
            {detailFacts(property).map((fact) => <Fact key={fact.label} label={fact.label} value={fact.value} />)}
          </dl>
        </div>
        <div className="rounded-lg border border-border bg-muted/25 p-3">
          <h3 className="text-sm font-semibold">Record information</h3>
          <dl className="mt-3 grid gap-3">
            <Fact label="Last updated" value={formatDateTime(property.updatedAt)} />
            <Fact label="Created" value={formatDateTime(property.createdAt)} />
            <Fact label="Record version" value={String(property.version)} />
          </dl>
        </div>
        {property.notes && <div className="lg:col-span-2"><h3 className="text-sm font-semibold">General notes</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{property.notes}</p></div>}
      </section>

      {property.details.type === "MULTIFAMILY" && (
        <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="property-units-title">
          <div className="border-b border-border p-4"><h2 id="property-units-title" className="text-lg font-semibold">Units</h2><p className="text-sm text-muted-foreground">{property.details.units.length} individually tracked {property.details.units.length === 1 ? "unit" : "units"}.</p></div>
          {property.details.units.length === 0 ? <div className="p-4 text-sm text-muted-foreground">No individual units have been recorded.</div> : (
            <Table><TableHeader><TableRow><TableHead>Unit</TableHead><TableHead>Bedrooms</TableHead><TableHead>Bathrooms</TableHead></TableRow></TableHeader><TableBody>{property.details.units.map((unit) => <TableRow key={unit.id}><TableCell className="font-medium">{unit.label}</TableCell><TableCell>{unit.bedrooms ?? "Not recorded"}</TableCell><TableCell>{unit.bathrooms ?? "Not recorded"}</TableCell></TableRow>)}</TableBody></Table>
          )}
        </section>
      )}

      <PropertyImageGallery property={property} />

      <AlertDialog open={confirmArchive} onOpenChange={(open) => { if (!mutationPending) setConfirmArchive(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{property.archivedAt ? "Restore this property?" : "Archive this property?"}</AlertDialogTitle>
            <AlertDialogDescription>{property.archivedAt ? "The property will return to the active inventory." : "The property will leave the active inventory but its details, units and images will be retained."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={mutationPending}>Cancel</AlertDialogCancel><AlertDialogAction variant={property.archivedAt ? "default" : "destructive"} loading={mutationPending} onClick={() => void changeArchiveState()}>{property.archivedAt ? "Restore property" : "Archive property"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 text-sm">{value}</dd></div>;
}

function detailFacts(property: PropertyDetail) {
  if (property.details.type === "SINGLE_FAMILY") return [
    { label: "Bedrooms", value: valueOrUnknown(property.details.bedrooms) },
    { label: "Bathrooms", value: valueOrUnknown(property.details.bathrooms) },
    { label: "Square footage", value: property.details.squareFeet ? property.details.squareFeet.toLocaleString("en-US") : "Not recorded" },
    { label: "Year built", value: valueOrUnknown(property.details.yearBuilt) },
    { label: "Parking", value: property.details.parkingType ? titleCase(property.details.parkingType) : "Not recorded" },
  ];
  if (property.details.type === "MULTIFAMILY") return [
    { label: "Subtype", value: property.details.subtype ?? "Not recorded" },
    { label: "Units", value: String(property.details.units.length) },
  ];
  return [
    { label: "Lot size", value: property.details.lotSize ? `${property.details.lotSize.value.toLocaleString("en-US")} ${property.details.lotSize.unit === "ACRES" ? "acres" : "sq ft"}` : "Not recorded" },
    { label: "Zoning", value: property.details.zoning ?? "Not recorded" },
    { label: "Land specifications", value: property.details.specifications ?? "Not recorded" },
  ];
}

function valueOrUnknown(value: number | null) { return value === null ? "Not recorded" : String(value); }
function titleCase(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase()); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The property action failed."; }
