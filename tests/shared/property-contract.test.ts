import { describe, expect, it } from "vitest";
import { PropertyDraftSchema } from "../../src/shared/contracts/property";
import { propertyDraft } from "../helpers/propertyFixtures";

describe("property contracts", () => {
  it("requires a street address for buildings", () => {
    const input = propertyDraft("SINGLE_FAMILY");
    input.address.line1 = null;

    const parsed = PropertyDraftSchema.safeParse(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({
        path: ["address", "line1"],
        message: "Street address is required.",
      }));
    }
  });

  it("accepts vacant land identified by a parcel reference", () => {
    expect(PropertyDraftSchema.safeParse(propertyDraft("VACANT_LAND"))).toMatchObject({ success: true });
  });

  it("requires unique multifamily unit labels without case sensitivity", () => {
    const input = propertyDraft("MULTIFAMILY");
    if (input.details.type !== "MULTIFAMILY") throw new Error("The multifamily fixture is invalid.");
    input.details.units[1]!.label = " a ";

    const parsed = PropertyDraftSchema.safeParse(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toContainEqual(expect.objectContaining({
        path: ["details", "units", 1, "label"],
        message: "Unit labels must be unique within a property.",
      }));
    }
  });

  it("rejects fields belonging to another property type", () => {
    const input = propertyDraft("SINGLE_FAMILY") as unknown as Record<string, unknown>;
    const details = input.details as Record<string, unknown>;
    details.zoning = "R-1";

    expect(PropertyDraftSchema.safeParse(input)).toMatchObject({ success: false });
  });

  it("normalizes state codes while preserving unknown operational details", () => {
    const input = propertyDraft("SINGLE_FAMILY");
    if (input.details.type !== "SINGLE_FAMILY") throw new Error("The single-family fixture is invalid.");
    input.address.state = "ks";
    input.details.bedrooms = null;
    input.details.bathrooms = null;

    expect(PropertyDraftSchema.parse(input)).toMatchObject({
      address: { state: "KS" },
      details: { bedrooms: null, bathrooms: null },
    });
  });
});
