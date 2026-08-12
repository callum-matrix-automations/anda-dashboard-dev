import { describe, expect, it, vi } from "vitest";
import { createSupabasePropertyRepository, PropertyRepositoryError } from "../../src/backend/repositories/supabase/supabasePropertyRepository";
import { actorId, imageId, propertyDetail, propertyDraft, propertyId, propertyListResponse } from "../helpers/propertyFixtures";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-key";

describe("Supabase property repository", () => {
  it("maps list filters, create and atomic update RPC inputs", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json(propertyListResponse("MULTIFAMILY")))
      .mockResolvedValueOnce(Response.json(propertyDetail("MULTIFAMILY")))
      .mockResolvedValueOnce(Response.json({ status: "saved", property: propertyDetail("VACANT_LAND", { version: 2 }) }));
    const repository = createSupabasePropertyRepository({ apiUrl, secretKey, fetchImplementation });

    await repository.list({ q: "Mission", type: "MULTIFAMILY", status: "active", limit: 25, offset: 50 });
    await repository.create(actorId, propertyDraft("MULTIFAMILY"));
    await repository.update({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      property: propertyDraft("VACANT_LAND"),
      confirmUnitRemoval: true,
    });

    expect(rpcName(fetchImplementation, 0)).toBe("list_properties");
    expect(requestBody(fetchImplementation, 0)).toEqual({
      p_query: "Mission",
      p_type: "MULTIFAMILY",
      p_status: "active",
      p_limit: 25,
      p_offset: 50,
    });
    expect(requestBody(fetchImplementation, 1)).toEqual({ p_actor_id: actorId, p_property: propertyDraft("MULTIFAMILY") });
    expect(requestBody(fetchImplementation, 2)).toMatchObject({
      p_property_id: propertyId,
      p_expected_version: 1,
      p_actor_id: actorId,
      p_confirm_unit_removal: true,
      p_property: { details: { type: "VACANT_LAND" } },
    });
  });

  it("maps archive, image attachment and authenticated metadata RPCs", async () => {
    const image = {
      id: imageId,
      fileName: "front.webp",
      mimeType: "image/webp",
      sizeBytes: 1_024,
      sortOrder: 0,
      createdBy: actorId,
      createdAt: "2026-08-12T12:00:00.000Z",
      contentUrl: `/api/properties/${propertyId}/images/${imageId}`,
    };
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "saved", property: propertyDetail("SINGLE_FAMILY", { version: 2, archivedAt: "2026-08-12T13:00:00.000Z" }) }))
      .mockResolvedValueOnce(Response.json({ status: "saved", image, propertyVersion: 3 }))
      .mockResolvedValueOnce(Response.json({
        storagePath: `${propertyId}/${imageId}.webp`,
        fileName: "front.webp",
        mimeType: "image/webp",
        sizeBytes: 1_024,
      }));
    const repository = createSupabasePropertyRepository({ apiUrl, secretKey, fetchImplementation });

    await repository.setArchived({ propertyId, expectedVersion: 1, actorProfileId: actorId, archived: true });
    await repository.attachImage({
      propertyId,
      expectedVersion: 2,
      actorProfileId: actorId,
      imageId,
      storagePath: `${propertyId}/${imageId}.webp`,
      fileName: "front.webp",
      mimeType: "image/webp",
      sizeBytes: 1_024,
    });
    await repository.getImageMetadata(propertyId, imageId);

    expect(requestBody(fetchImplementation, 0)).toMatchObject({ p_archived: true, p_expected_version: 1 });
    expect(requestBody(fetchImplementation, 1)).toMatchObject({ p_image_id: imageId, p_mime_type: "image/webp" });
    expect(requestBody(fetchImplementation, 2)).toEqual({ p_property_id: propertyId, p_image_id: imageId });
  });

  it("rejects invalid or failed persistence responses", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: "invalid" }))
      .mockResolvedValueOnce(Response.json({ code: "PGRST202", message: "RPC unavailable" }, { status: 404 }));
    const repository = createSupabasePropertyRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.list({ q: "", type: null, status: "active", limit: 25, offset: 0 }))
      .rejects.toMatchObject({ code: "invalid_supabase_response" } satisfies Partial<PropertyRepositoryError>);
    await expect(repository.get(propertyId))
      .rejects.toMatchObject({ code: "PGRST202", status: 404 } satisfies Partial<PropertyRepositoryError>);
  });
});

function requestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [, options] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return JSON.parse(String(options.body)) as unknown;
}

function rpcName(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [url] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return url.pathname.split("/").at(-1);
}
