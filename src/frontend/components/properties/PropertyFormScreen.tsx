"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiClientError } from "@/frontend/api-client/client";
import { useCreateProperty, useProperty, useUpdateProperty, useUploadPropertyImage } from "@/frontend/hooks/useApi";
import { AddIcon, RemoveIcon } from "@/frontend/components/design-system/icons";
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
import { Button, buttonVariants } from "@/frontend/components/design-system/primitives/button";
import { Input } from "@/frontend/components/design-system/primitives/input";
import { Label } from "@/frontend/components/design-system/primitives/label";
import { Textarea } from "@/frontend/components/design-system/primitives/textarea";
import { ErrorState, LoadingState } from "@/frontend/components/shared/States";
import {
  LOT_SIZE_UNITS,
  PARKING_TYPES,
  PROPERTY_IMAGE_MAX_BYTES,
  PROPERTY_IMAGE_MAX_COUNT,
  PROPERTY_TYPES,
  PropertyDraftSchema,
  type LotSizeUnit,
  type ParkingType,
  type PropertyDetail,
  type PropertyDraft,
  type PropertyType,
} from "@/shared/contracts/property";
import { PROPERTY_TYPE_LABELS, nativeSelectClass } from "./propertyPresentation";

interface UnitFormState {
  key: string;
  label: string;
  bedrooms: string;
  bathrooms: string;
}

interface PropertyFormState {
  type: PropertyType;
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  parcelReference: string;
  notes: string;
  bedrooms: string;
  bathrooms: string;
  squareFeet: string;
  yearBuilt: string;
  parkingType: ParkingType | "";
  multifamilySubtype: string;
  units: UnitFormState[];
  lotSize: string;
  lotSizeUnit: LotSizeUnit;
  zoning: string;
  specifications: string;
}

export function PropertyFormScreen({ propertyId }: { propertyId?: string }) {
  const editing = Boolean(propertyId);
  const query = useProperty(propertyId ?? "", editing);

  if (editing && query.isLoading) return <LoadingState label="Loading property editor" />;
  if (editing && query.isError) return <ErrorState message={errorMessage(query.error)} retry={() => void query.refetch()} retrying={query.isFetching} />;
  if (editing && !query.data) return <ErrorState message="The property was not found." />;
  if (query.data?.archivedAt) {
    return (
      <div className="grid gap-4">
        <ErrorState message="Restore this property before editing it." />
        <div><Link href={`/app/properties/${query.data.id}`} className={buttonVariants({ variant: "outline" })}>Back to property</Link></div>
      </div>
    );
  }
  return <PropertyEditor key={query.data?.id ?? "new-property"} property={query.data} />;
}

function PropertyEditor({ property }: { property?: PropertyDetail }) {
  const router = useRouter();
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const upload = useUploadPropertyImage();
  const [form, setForm] = useState(() => initialState(property));
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState("");
  const [confirmUnits, setConfirmUnits] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const saving = create.isPending || update.isPending || upload.isPending;

  const submit = async (confirmUnitRemoval = false) => {
    const parsed = PropertyDraftSchema.safeParse(toDraft(form));
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])));
      setSubmissionError("Review the highlighted property details.");
      return;
    }
    setFieldErrors({});
    setSubmissionError("");

    let saved: PropertyDetail;
    try {
      saved = property
        ? await update.mutateAsync({
          propertyId: property.id,
          input: { expectedVersion: property.version, property: parsed.data, confirmUnitRemoval },
        })
        : await create.mutateAsync(parsed.data);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "unit_removal_confirmation_required") {
        setConfirmUnits(true);
        return;
      }
      setSubmissionError(errorMessage(error));
      return;
    }

    let version = saved.version;
    try {
      for (const [index, file] of pendingFiles.entries()) {
        setUploadLabel(`Uploading ${index + 1} of ${pendingFiles.length}: ${file.name}`);
        const result = await upload.mutateAsync({ propertyId: saved.id, expectedVersion: version, file });
        version = result.propertyVersion;
      }
    } catch (error) {
      toast.error(`The property was saved, but an image upload failed: ${errorMessage(error)}`);
      router.push(`/app/properties/${saved.id}`);
      return;
    } finally {
      setUploadLabel("");
    }

    toast.success(property ? "Property updated." : "Property added to the inventory.");
    router.push(`/app/properties/${saved.id}`);
  };

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const existingCount = property?.images.length ?? 0;
    if (existingCount + pendingFiles.length + selected.length > PROPERTY_IMAGE_MAX_COUNT) {
      setSubmissionError(`A property can have up to ${PROPERTY_IMAGE_MAX_COUNT} images.`);
      return;
    }
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > PROPERTY_IMAGE_MAX_BYTES);
    if (invalid) {
      setSubmissionError("Choose JPEG, PNG or WebP images no larger than 10 MB each.");
      return;
    }
    setPendingFiles((current) => [...current, ...selected]);
    setSubmissionError("");
  };

  const setValue = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateUnit = (index: number, key: keyof Omit<UnitFormState, "key">, value: string) => {
    setForm((current) => ({
      ...current,
      units: current.units.map((unit, unitIndex) => unitIndex === index ? { ...unit, [key]: value } : unit),
    }));
  };

  const removeUnit = (index: number) => setForm((current) => ({ ...current, units: current.units.filter((_, unitIndex) => unitIndex !== index) }));
  const addUnit = () => setForm((current) => ({ ...current, units: [...current.units, emptyUnit()] }));

  return (
    <div className="grid gap-4">
      <header>
        <div className="text-xs font-semibold tracking-wide text-secondary"><Link href="/app/properties" className="hover:underline">Property Centre</Link> · {property ? "Edit property" : "New property"}</div>
        <h1 className="mt-0.5 text-2xl font-semibold">{property ? property.formattedAddress : "Add an owned property"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Only the property type and an address or parcel reference are required. Add whatever is currently known.</p>
      </header>

      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
        <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
          <div><h2 className="text-lg font-semibold">Identity and location</h2><p className="text-sm text-muted-foreground">Use the property address as its primary inventory reference.</p></div>
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="property-form-type">Property type</Label>
            <select id="property-form-type" className={nativeSelectClass} value={form.type} disabled={saving} onChange={(event) => setValue("type", event.target.value as PropertyType)}>
              {PROPERTY_TYPES.map((value) => <option key={value} value={value}>{PROPERTY_TYPE_LABELS[value]}</option>)}
            </select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Street address" path="address.line1" errors={fieldErrors} className="sm:col-span-2"><Input value={form.line1} maxLength={160} disabled={saving} onChange={(event) => setValue("line1", event.target.value)} placeholder={form.type === "VACANT_LAND" ? "Optional when a parcel reference is supplied" : "123 Main Street"} /></FormField>
            <FormField label="Address line 2" path="address.line2" errors={fieldErrors} className="sm:col-span-2"><Input value={form.line2} maxLength={160} disabled={saving} onChange={(event) => setValue("line2", event.target.value)} placeholder="Suite, building or additional location" /></FormField>
            <FormField label="City" path="address.city" errors={fieldErrors}><Input value={form.city} maxLength={120} disabled={saving} onChange={(event) => setValue("city", event.target.value)} /></FormField>
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <FormField label="State" path="address.state" errors={fieldErrors}><Input value={form.state} maxLength={2} disabled={saving} onChange={(event) => setValue("state", event.target.value.toUpperCase())} placeholder="KS" /></FormField>
              <FormField label="ZIP code" path="address.postalCode" errors={fieldErrors}><Input value={form.postalCode} maxLength={10} disabled={saving} onChange={(event) => setValue("postalCode", event.target.value)} placeholder="66106" /></FormField>
            </div>
            <FormField label="Parcel reference" path="address.parcelReference" errors={fieldErrors} className="sm:col-span-2"><Input value={form.parcelReference} maxLength={120} disabled={saving} onChange={(event) => setValue("parcelReference", event.target.value)} placeholder="Parcel number or lot reference" /></FormField>
          </div>
        </section>

        <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
          <div><h2 className="text-lg font-semibold">{PROPERTY_TYPE_LABELS[form.type]} details</h2><p className="text-sm text-muted-foreground">Unknown values can be left blank and added later.</p></div>
          {form.type === "SINGLE_FAMILY" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField label="Bedrooms" path="details.bedrooms" errors={fieldErrors} value={form.bedrooms} setValue={(value) => setValue("bedrooms", value)} disabled={saving} min="0" step="1" />
              <NumberField label="Bathrooms" path="details.bathrooms" errors={fieldErrors} value={form.bathrooms} setValue={(value) => setValue("bathrooms", value)} disabled={saving} min="0" step="0.5" />
              <NumberField label="Square footage" path="details.squareFeet" errors={fieldErrors} value={form.squareFeet} setValue={(value) => setValue("squareFeet", value)} disabled={saving} min="1" step="1" />
              <NumberField label="Year built" path="details.yearBuilt" errors={fieldErrors} value={form.yearBuilt} setValue={(value) => setValue("yearBuilt", value)} disabled={saving} min="1700" step="1" />
              <FormField label="Parking type" path="details.parkingType" errors={fieldErrors}><select className={nativeSelectClass} value={form.parkingType} disabled={saving} onChange={(event) => setValue("parkingType", event.target.value as ParkingType | "")}><option value="">Not recorded</option>{PARKING_TYPES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></FormField>
            </div>
          )}

          {form.type === "MULTIFAMILY" && (
            <div className="grid gap-4">
              <FormField label="Property subtype" path="details.subtype" errors={fieldErrors} className="max-w-md"><Input value={form.multifamilySubtype} maxLength={120} disabled={saving} onChange={(event) => setValue("multifamilySubtype", event.target.value)} placeholder="e.g. Duplex or fourplex" /></FormField>
              <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">Individual units</h3><p className="text-xs text-muted-foreground">Use number or letter labels such as 1, 2, A or B.</p></div><Button type="button" size="sm" variant="outline" disabled={saving || form.units.length >= 200} onClick={addUnit}><AddIcon aria-hidden /> Add unit</Button></div>
              {form.units.length === 0 ? <div className="rounded-lg border border-dashed border-border bg-muted/30 p-5 text-center text-sm text-muted-foreground">No units added yet.</div> : (
                <div className="grid gap-2">{form.units.map((unit, index) => (
                  <div key={unit.key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(8rem,1fr)_8rem_8rem_auto] sm:items-end">
                    <FormField label="Unit label" path={`details.units.${index}.label`} errors={fieldErrors}><Input value={unit.label} maxLength={40} disabled={saving} onChange={(event) => updateUnit(index, "label", event.target.value)} /></FormField>
                    <NumberField label="Bedrooms" path={`details.units.${index}.bedrooms`} errors={fieldErrors} value={unit.bedrooms} setValue={(value) => updateUnit(index, "bedrooms", value)} disabled={saving} min="0" step="1" />
                    <NumberField label="Bathrooms" path={`details.units.${index}.bathrooms`} errors={fieldErrors} value={unit.bathrooms} setValue={(value) => updateUnit(index, "bathrooms", value)} disabled={saving} min="0" step="0.5" />
                    <Button type="button" size="icon" variant="ghost" disabled={saving} aria-label={`Remove unit ${unit.label || index + 1}`} onClick={() => removeUnit(index)}><RemoveIcon aria-hidden /></Button>
                  </div>
                ))}</div>
              )}
            </div>
          )}

          {form.type === "VACANT_LAND" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid grid-cols-[minmax(0,1fr)_10rem] gap-3">
                <NumberField label="Lot size" path="details.lotSize.value" errors={fieldErrors} value={form.lotSize} setValue={(value) => setValue("lotSize", value)} disabled={saving} min="0.0001" step="any" />
                <FormField label="Unit" path="details.lotSize.unit" errors={fieldErrors}><select className={nativeSelectClass} value={form.lotSizeUnit} disabled={saving || !form.lotSize} onChange={(event) => setValue("lotSizeUnit", event.target.value as LotSizeUnit)}>{LOT_SIZE_UNITS.map((value) => <option key={value} value={value}>{value === "ACRES" ? "Acres" : "Square feet"}</option>)}</select></FormField>
              </div>
              <FormField label="Zoning" path="details.zoning" errors={fieldErrors}><Input value={form.zoning} maxLength={120} disabled={saving} onChange={(event) => setValue("zoning", event.target.value)} placeholder="Current zoning classification" /></FormField>
              <FormField label="Land specifications" path="details.specifications" errors={fieldErrors} className="sm:col-span-2"><Textarea className="min-h-28" value={form.specifications} maxLength={2000} disabled={saving} onChange={(event) => setValue("specifications", event.target.value)} placeholder="Access, utilities, frontage or other useful specifications" /></FormField>
            </div>
          )}
        </section>

        <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
          <div><h2 className="text-lg font-semibold">Notes and new images</h2><p className="text-sm text-muted-foreground">Images are uploaded to private storage after the property details are saved.</p></div>
          <FormField label="General notes" path="notes" errors={fieldErrors}><Textarea className="min-h-32" value={form.notes} maxLength={5000} disabled={saving} onChange={(event) => setValue("notes", event.target.value)} /></FormField>
          <div className="grid gap-1.5">
            <Label htmlFor="property-form-images">Add images</Label>
            <Input id="property-form-images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving || (property?.images.length ?? 0) + pendingFiles.length >= PROPERTY_IMAGE_MAX_COUNT} onChange={(event) => addFiles(event.target.files)} />
            <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. Maximum 10 images per property and 10 MB each.</p>
          </div>
          {pendingFiles.length > 0 && <ul className="grid gap-1.5">{pendingFiles.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate">{file.name}</span><Button type="button" size="icon-sm" variant="ghost" disabled={saving} aria-label={`Remove pending image ${file.name}`} onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}><RemoveIcon aria-hidden /></Button></li>)}</ul>}
        </section>

        {submissionError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{submissionError}</div>}
        {uploadLabel && <p role="status" className="text-sm text-muted-foreground">{uploadLabel}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Link href={property ? `/app/properties/${property.id}` : "/app/properties"} className={buttonVariants({ variant: "outline" })} aria-disabled={saving}>Cancel</Link>
          <Button type="submit" loading={saving}>{saving ? "Saving property..." : property ? "Save changes" : "Add property"}</Button>
        </div>
      </form>

      <AlertDialog open={confirmUnits} onOpenChange={(open) => { if (!saving) setConfirmUnits(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove saved units?</AlertDialogTitle><AlertDialogDescription>This update removes one or more existing multifamily units. Their labels and bedroom/bathroom details will be deleted from this property.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep editing</AlertDialogCancel><AlertDialogAction variant="destructive" loading={saving} onClick={() => { setConfirmUnits(false); void submit(true); }}>Remove units and save</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FormField({ label, path, errors, className = "", children }: { label: string; path: string; errors: Record<string, string>; className?: string; children: ReactNode }) {
  const id = `property-field-${path.replaceAll(".", "-")}`;
  const errorId = `${id}-error`;
  const error = errors[path];
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
      id,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? errorId : undefined,
    })
    : children;
  return <div className={`grid gap-1.5 ${className}`}><Label htmlFor={id}>{label}</Label>{control}{error && <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p>}</div>;
}

function NumberField({ label, path, errors, value, setValue, disabled, min, step }: { label: string; path: string; errors: Record<string, string>; value: string; setValue: (value: string) => void; disabled: boolean; min: string; step: string }) {
  return <FormField label={label} path={path} errors={errors}><Input type="number" min={min} step={step} value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} /></FormField>;
}

function initialState(property?: PropertyDetail): PropertyFormState {
  const state: PropertyFormState = {
    type: property?.details.type ?? "SINGLE_FAMILY",
    line1: property?.address.line1 ?? "",
    line2: property?.address.line2 ?? "",
    city: property?.address.city ?? "Kansas City",
    state: property?.address.state ?? "KS",
    postalCode: property?.address.postalCode ?? "",
    parcelReference: property?.address.parcelReference ?? "",
    notes: property?.notes ?? "",
    bedrooms: "",
    bathrooms: "",
    squareFeet: "",
    yearBuilt: "",
    parkingType: "",
    multifamilySubtype: "",
    units: [],
    lotSize: "",
    lotSizeUnit: "SQUARE_FEET",
    zoning: "",
    specifications: "",
  };
  if (property?.details.type === "SINGLE_FAMILY") {
    state.bedrooms = valueString(property.details.bedrooms);
    state.bathrooms = valueString(property.details.bathrooms);
    state.squareFeet = valueString(property.details.squareFeet);
    state.yearBuilt = valueString(property.details.yearBuilt);
    state.parkingType = property.details.parkingType ?? "";
  } else if (property?.details.type === "MULTIFAMILY") {
    state.multifamilySubtype = property.details.subtype ?? "";
    state.units = property.details.units.map((unit) => ({ key: unit.id, label: unit.label, bedrooms: valueString(unit.bedrooms), bathrooms: valueString(unit.bathrooms) }));
  } else if (property?.details.type === "VACANT_LAND") {
    state.lotSize = valueString(property.details.lotSize?.value ?? null);
    state.lotSizeUnit = property.details.lotSize?.unit ?? "SQUARE_FEET";
    state.zoning = property.details.zoning ?? "";
    state.specifications = property.details.specifications ?? "";
  }
  return state;
}

function toDraft(form: PropertyFormState): PropertyDraft {
  const address = {
    line1: nullableText(form.line1),
    line2: nullableText(form.line2),
    city: form.city,
    state: form.state,
    postalCode: nullableText(form.postalCode),
    parcelReference: nullableText(form.parcelReference),
  };
  const common = { address, notes: nullableText(form.notes) };
  if (form.type === "SINGLE_FAMILY") return {
    ...common,
    details: {
      type: "SINGLE_FAMILY",
      bedrooms: nullableNumber(form.bedrooms),
      bathrooms: nullableNumber(form.bathrooms),
      squareFeet: nullableNumber(form.squareFeet),
      yearBuilt: nullableNumber(form.yearBuilt),
      parkingType: form.parkingType || null,
    },
  };
  if (form.type === "MULTIFAMILY") return {
    ...common,
    details: {
      type: "MULTIFAMILY",
      subtype: nullableText(form.multifamilySubtype),
      units: form.units.map((unit) => ({ label: unit.label, bedrooms: nullableNumber(unit.bedrooms), bathrooms: nullableNumber(unit.bathrooms) })),
    },
  };
  return {
    ...common,
    details: {
      type: "VACANT_LAND",
      lotSize: form.lotSize ? { value: Number(form.lotSize), unit: form.lotSizeUnit } : null,
      zoning: nullableText(form.zoning),
      specifications: nullableText(form.specifications),
    },
  };
}

function emptyUnit(): UnitFormState { return { key: crypto.randomUUID(), label: "", bedrooms: "", bathrooms: "" }; }
function nullableText(value: string) { const trimmed = value.trim(); return trimmed ? trimmed : null; }
function nullableNumber(value: string) { return value.trim() ? Number(value) : null; }
function valueString(value: number | null) { return value === null ? "" : String(value); }
function titleCase(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase()); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "The property could not be saved."; }
