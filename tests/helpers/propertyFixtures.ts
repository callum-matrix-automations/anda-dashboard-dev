import type { PropertyDetail, PropertyDraft, PropertyType } from "../../src/shared/contracts/property";

export const propertyId = "70000000-0000-4000-8000-000000000001";
export const imageId = "70000000-0000-4000-8000-000000000002";
export const unitOneId = "70000000-0000-4000-8000-000000000003";
export const unitTwoId = "70000000-0000-4000-8000-000000000004";
export const actorId = "10000000-0000-4000-8000-000000000003";

export function propertyDraft(type: PropertyType = "SINGLE_FAMILY"): PropertyDraft {
  const address = {
    line1: type === "VACANT_LAND" ? null : "4120 Mission Road",
    line2: null,
    city: "Kansas City",
    state: "KS",
    postalCode: "66103",
    parcelReference: type === "VACANT_LAND" ? "ANDA-LOT-021" : null,
  };
  if (type === "MULTIFAMILY") {
    return {
      address,
      notes: "Deterministic multifamily fixture.",
      details: {
        type,
        subtype: "Duplex",
        units: [
          { label: "A", bedrooms: 2, bathrooms: 1 },
          { label: "B", bedrooms: 3, bathrooms: 1.5 },
        ],
      },
    };
  }
  if (type === "VACANT_LAND") {
    return {
      address,
      notes: "Deterministic vacant-land fixture.",
      details: {
        type,
        lotSize: { value: 1.75, unit: "ACRES" },
        zoning: "R-1",
        specifications: "Road frontage available.",
      },
    };
  }
  return {
    address,
    notes: "Deterministic single-family fixture.",
    details: {
      type,
      bedrooms: 3,
      bathrooms: 2,
      squareFeet: 1_640,
      yearBuilt: 1988,
      parkingType: "GARAGE",
    },
  };
}

export function propertyDetail(type: PropertyType = "SINGLE_FAMILY", overrides: Partial<PropertyDetail> = {}): PropertyDetail {
  const draft = propertyDraft(type);
  const details = draft.details.type === "MULTIFAMILY"
    ? {
      ...draft.details,
      units: draft.details.units.map((unit, index) => ({
        ...unit,
        id: index === 0 ? unitOneId : unitTwoId,
        sortOrder: index,
      })),
    }
    : draft.details;
  const detail: PropertyDetail = {
    id: propertyId,
    version: 1,
    address: draft.address,
    formattedAddress: type === "VACANT_LAND"
      ? "Parcel ANDA-LOT-021, Kansas City, KS 66103"
      : "4120 Mission Road, Kansas City, KS 66103",
    notes: draft.notes,
    details,
    images: [],
    createdBy: actorId,
    updatedBy: actorId,
    createdAt: "2026-08-12T12:00:00.000Z",
    updatedAt: "2026-08-12T12:00:00.000Z",
    archivedBy: null,
    archivedAt: null,
    ...overrides,
  };
  if (detail.archivedAt && !detail.archivedBy) detail.archivedBy = actorId;
  return detail;
}

export function propertyListResponse(type: PropertyType = "SINGLE_FAMILY") {
  return {
    items: [propertyDetail(type)],
    total: 1,
    limit: 25,
    offset: 0,
    summary: {
      activeTotal: 3,
      singleFamily: 1,
      multifamily: 1,
      vacantLand: 1,
      totalUnits: 2,
      archivedTotal: 1,
    },
  };
}
