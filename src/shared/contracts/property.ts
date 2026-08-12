import { z } from "zod";

export const PROPERTY_TYPES = ["SINGLE_FAMILY", "MULTIFAMILY", "VACANT_LAND"] as const;
export const PropertyTypeSchema = z.enum(PROPERTY_TYPES);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;

export const PROPERTY_LIST_STATUSES = ["active", "archived", "all"] as const;
export const PropertyListStatusSchema = z.enum(PROPERTY_LIST_STATUSES);
export type PropertyListStatus = z.infer<typeof PropertyListStatusSchema>;

export const PARKING_TYPES = ["NONE", "STREET", "DRIVEWAY", "CARPORT", "GARAGE", "OTHER"] as const;
export const ParkingTypeSchema = z.enum(PARKING_TYPES);
export type ParkingType = z.infer<typeof ParkingTypeSchema>;

export const LOT_SIZE_UNITS = ["SQUARE_FEET", "ACRES"] as const;
export const LotSizeUnitSchema = z.enum(LOT_SIZE_UNITS);
export type LotSizeUnit = z.infer<typeof LotSizeUnitSchema>;

export const PROPERTY_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PropertyImageMimeTypeSchema = z.enum(PROPERTY_IMAGE_MIME_TYPES);
export type PropertyImageMimeType = z.infer<typeof PropertyImageMimeTypeSchema>;

export const PROPERTY_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PROPERTY_IMAGE_MAX_COUNT = 10;

const optionalText = (maximum: number) => z.string().trim().max(maximum).nullable();
const optionalCount = z.number().int().min(0).max(99).nullable();
const optionalBathrooms = z.number().min(0).max(99).nullable();
const isoDateTime = z.string().datetime({ offset: true });

export const PropertyAddressSchema = z.object({
  line1: optionalText(160),
  line2: optionalText(160),
  city: z.string().trim().min(1, "City is required.").max(120),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/u, "Use a two-letter state code.")
    .transform((value) => value.toUpperCase()),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/u, "Enter a valid US ZIP code.").nullable(),
  parcelReference: optionalText(120),
}).strict();
export type PropertyAddress = z.infer<typeof PropertyAddressSchema>;

export const PropertyUnitInputSchema = z.object({
  label: z.string().trim().min(1, "Unit label is required.").max(40),
  bedrooms: optionalCount,
  bathrooms: optionalBathrooms,
}).strict();
export type PropertyUnitInput = z.infer<typeof PropertyUnitInputSchema>;

export const PropertyUnitSchema = PropertyUnitInputSchema.extend({
  id: z.string().uuid(),
  sortOrder: z.number().int().min(0),
}).strict();
export type PropertyUnit = z.infer<typeof PropertyUnitSchema>;

const singleFamilyDetailsShape = {
  type: z.literal("SINGLE_FAMILY"),
  bedrooms: optionalCount,
  bathrooms: optionalBathrooms,
  squareFeet: z.number().int().positive().max(10_000_000).nullable(),
  yearBuilt: z.number().int().min(1700).max(3000).nullable(),
  parkingType: ParkingTypeSchema.nullable(),
};

const multifamilyInputDetailsShape = {
  type: z.literal("MULTIFAMILY"),
  subtype: optionalText(120),
  units: z.array(PropertyUnitInputSchema).max(200),
};

const vacantLandDetailsShape = {
  type: z.literal("VACANT_LAND"),
  lotSize: z.object({
    value: z.number().positive().max(1_000_000_000),
    unit: LotSizeUnitSchema,
  }).strict().nullable(),
  zoning: optionalText(120),
  specifications: optionalText(2_000),
};

export const PropertyDetailsInputSchema = z.discriminatedUnion("type", [
  z.object(singleFamilyDetailsShape).strict(),
  z.object(multifamilyInputDetailsShape).strict(),
  z.object(vacantLandDetailsShape).strict(),
]).superRefine((details, context) => {
  if (details.type === "MULTIFAMILY") validateUniqueUnitLabels(details, context);
});
export type PropertyDetailsInput = z.infer<typeof PropertyDetailsInputSchema>;

export const PropertyDraftSchema = z.object({
  address: PropertyAddressSchema,
  notes: optionalText(5_000),
  details: PropertyDetailsInputSchema,
}).strict().superRefine((property, context) => {
  if (property.address.line1) return;
  if (property.details.type === "VACANT_LAND" && property.address.parcelReference) return;
  context.addIssue({
    code: "custom",
    path: ["address", "line1"],
    message: property.details.type === "VACANT_LAND"
      ? "Enter a street address or parcel reference."
      : "Street address is required.",
  });
});
export type PropertyDraft = z.infer<typeof PropertyDraftSchema>;

const PropertyDetailsSchema = z.discriminatedUnion("type", [
  z.object(singleFamilyDetailsShape).strict(),
  z.object({
    type: z.literal("MULTIFAMILY"),
    subtype: optionalText(120),
    units: z.array(PropertyUnitSchema).max(200),
  }).strict(),
  z.object(vacantLandDetailsShape).strict(),
]).superRefine((details, context) => {
  if (details.type === "MULTIFAMILY") validateUniqueUnitLabels(details, context);
});

export const PropertyImageSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: PropertyImageMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(PROPERTY_IMAGE_MAX_BYTES),
  sortOrder: z.number().int().min(0),
  createdBy: z.string().uuid(),
  createdAt: isoDateTime,
  contentUrl: z.string().min(1),
}).strict();
export type PropertyImage = z.infer<typeof PropertyImageSchema>;

export const PropertyDetailSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  address: PropertyAddressSchema,
  formattedAddress: z.string().trim().min(1),
  notes: z.string().nullable(),
  details: PropertyDetailsSchema,
  images: z.array(PropertyImageSchema).max(PROPERTY_IMAGE_MAX_COUNT),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  archivedBy: z.string().uuid().nullable(),
  archivedAt: isoDateTime.nullable(),
}).strict();
export type PropertyDetail = z.infer<typeof PropertyDetailSchema>;

export const PropertyListQuerySchema = z.object({
  q: z.string().trim().max(200).default(""),
  type: PropertyTypeSchema.nullable().default(null),
  status: PropertyListStatusSchema.default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
export type PropertyListQuery = z.infer<typeof PropertyListQuerySchema>;

export const PropertyInventorySummarySchema = z.object({
  activeTotal: z.number().int().min(0),
  singleFamily: z.number().int().min(0),
  multifamily: z.number().int().min(0),
  vacantLand: z.number().int().min(0),
  totalUnits: z.number().int().min(0),
  archivedTotal: z.number().int().min(0),
}).strict();
export type PropertyInventorySummary = z.infer<typeof PropertyInventorySummarySchema>;

export const PropertyListResponseSchema = z.object({
  items: z.array(PropertyDetailSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  summary: PropertyInventorySummarySchema,
}).strict();
export type PropertyListResponse = z.infer<typeof PropertyListResponseSchema>;

export const PropertyUpdateRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
  property: PropertyDraftSchema,
  confirmUnitRemoval: z.boolean().default(false),
}).strict();
export type PropertyUpdateRequest = z.infer<typeof PropertyUpdateRequestSchema>;

export const PropertyVersionedRequestSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();
export type PropertyVersionedRequest = z.infer<typeof PropertyVersionedRequestSchema>;

export const PropertyImageMutationResponseSchema = z.object({
  image: PropertyImageSchema.nullable(),
  propertyVersion: z.number().int().positive(),
}).strict();
export type PropertyImageMutationResponse = z.infer<typeof PropertyImageMutationResponseSchema>;

function validateUniqueUnitLabels(
  value: { units: Array<{ label: string }> },
  context: z.RefinementCtx,
) {
  const labels = new Set<string>();
  value.units.forEach((unit, index) => {
    const normalized = unit.label.trim().toLocaleLowerCase("en-US");
    if (labels.has(normalized)) {
      context.addIssue({
        code: "custom",
        path: ["units", index, "label"],
        message: "Unit labels must be unique within a property.",
      });
    }
    labels.add(normalized);
  });
}
