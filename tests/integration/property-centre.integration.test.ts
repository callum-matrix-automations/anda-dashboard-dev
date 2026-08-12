import { describe, expect, it } from "vitest";
import { createSupabasePropertyImageStorage } from "../../src/backend/repositories/supabase/supabasePropertyImageStorage";
import { createSupabasePropertyRepository } from "../../src/backend/repositories/supabase/supabasePropertyRepository";
import { createPropertyService } from "../../src/backend/services/properties/propertyService";
import type { PropertyDraft } from "../../src/shared/contracts/property";
import { actorId, propertyDraft } from "../helpers/propertyFixtures";
import { localSupabaseConfiguration } from "./pre-approval-workflow.helpers";

const configuration = localSupabaseConfiguration();
const fixtureToken = "ANDA-021-INTEGRATION";

describe.skipIf(!configuration.configured)("local Supabase Property Centre", () => {
  it("persists all property types, units, conflicts, private images, archive and restore", async () => {
    const repository = createSupabasePropertyRepository(configuration);
    const storage = createSupabasePropertyImageStorage(configuration);
    const service = createPropertyService({ repository, storage });

    const singleFamily = await repository.create(actorId, identifiedDraft("SINGLE_FAMILY", "SF"));
    const multifamily = await repository.create(actorId, identifiedDraft("MULTIFAMILY", "MF"));
    const vacantLand = await repository.create(actorId, identifiedDraft("VACANT_LAND", "LAND"));

    const list = await repository.list({ q: fixtureToken, type: null, status: "active", limit: 100, offset: 0 });
    expect(list.items.map((property) => property.id)).toEqual(expect.arrayContaining([
      singleFamily.id,
      multifamily.id,
      vacantLand.id,
    ]));
    expect(list.summary).toMatchObject({
      activeTotal: expect.any(Number),
      singleFamily: expect.any(Number),
      multifamily: expect.any(Number),
      vacantLand: expect.any(Number),
      totalUnits: expect.any(Number),
    });
    expect(list.summary.singleFamily).toBeGreaterThanOrEqual(1);
    expect(list.summary.multifamily).toBeGreaterThanOrEqual(1);
    expect(list.summary.vacantLand).toBeGreaterThanOrEqual(1);
    expect(list.summary.totalUnits).toBeGreaterThanOrEqual(2);

    const reducedUnits = identifiedDraft("MULTIFAMILY", "MF");
    if (reducedUnits.details.type !== "MULTIFAMILY") throw new Error("The multifamily fixture is invalid.");
    reducedUnits.details.units = reducedUnits.details.units.slice(0, 1);
    await expect(repository.update({
      propertyId: multifamily.id,
      expectedVersion: multifamily.version,
      actorProfileId: actorId,
      property: reducedUnits,
      confirmUnitRemoval: false,
    })).resolves.toEqual({ status: "unit_removal_confirmation_required", version: multifamily.version });

    const updated = await repository.update({
      propertyId: multifamily.id,
      expectedVersion: multifamily.version,
      actorProfileId: actorId,
      property: reducedUnits,
      confirmUnitRemoval: true,
    });
    expect(updated).toMatchObject({ status: "saved", property: { version: multifamily.version + 1 } });
    if (updated.status !== "saved") throw new Error("The multifamily fixture was not updated.");
    expect(updated.property.details).toMatchObject({ type: "MULTIFAMILY", units: [{ label: "A" }] });

    await expect(repository.update({
      propertyId: multifamily.id,
      expectedVersion: multifamily.version,
      actorProfileId: actorId,
      property: reducedUnits,
      confirmUnitRemoval: true,
    })).resolves.toEqual({ status: "conflict", version: multifamily.version + 1 });

    const bytes = pngBytes();
    const upload = await service.uploadImage({
      propertyId: singleFamily.id,
      expectedVersion: singleFamily.version,
      actorProfileId: actorId,
      fileName: "integration-front.png",
      declaredMimeType: "image/png",
      bytes,
    });
    expect(upload).toMatchObject({ status: "saved", propertyVersion: singleFamily.version + 1 });
    if (upload.status !== "saved") throw new Error("The integration image was not attached.");
    const loaded = await service.loadImage(singleFamily.id, upload.image.id);
    expect(loaded?.bytes).toEqual(bytes);
    await expect(service.removeImage({
      propertyId: singleFamily.id,
      imageId: upload.image.id,
      expectedVersion: upload.propertyVersion,
      actorProfileId: actorId,
    })).resolves.toMatchObject({ status: "saved", propertyVersion: upload.propertyVersion + 1 });

    const archived = await repository.setArchived({
      propertyId: vacantLand.id,
      expectedVersion: vacantLand.version,
      actorProfileId: actorId,
      archived: true,
    });
    expect(archived).toMatchObject({ status: "saved", property: { archivedAt: expect.any(String) } });
    if (archived.status !== "saved") throw new Error("The vacant-land fixture was not archived.");
    const archivedList = await repository.list({ q: `${fixtureToken}-LAND`, type: null, status: "archived", limit: 25, offset: 0 });
    expect(archivedList.items).toContainEqual(expect.objectContaining({ id: vacantLand.id }));

    await expect(repository.setArchived({
      propertyId: vacantLand.id,
      expectedVersion: archived.property.version,
      actorProfileId: actorId,
      archived: false,
    })).resolves.toMatchObject({ status: "saved", property: { archivedAt: null } });
  }, 30_000);
});

function identifiedDraft(type: "SINGLE_FAMILY" | "MULTIFAMILY" | "VACANT_LAND", suffix: string): PropertyDraft {
  const draft = propertyDraft(type);
  draft.address.parcelReference = `${fixtureToken}-${suffix}`;
  return draft;
}

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);
}
