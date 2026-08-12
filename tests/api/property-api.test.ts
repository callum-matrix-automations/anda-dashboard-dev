import { describe, expect, it, vi } from "vitest";
import {
  createPropertyArchiveHandler,
  createPropertyCreateHandler,
  createPropertyDetailHandler,
  createPropertyImageContentHandler,
  createPropertyListHandler,
  createPropertyUpdateHandler,
} from "../../src/backend/integrations/properties/propertyApiHandlers";
import { actorId, imageId, propertyDetail, propertyDraft, propertyId, propertyListResponse } from "../helpers/propertyFixtures";

const userResolver = vi.fn().mockResolvedValue({
  profileId: actorId,
  displayName: "Priya Shah",
  role: "USER" as const,
  isAdmin: false,
});

describe("property API handlers", () => {
  it("allows an ordinary current app user to list filtered inventory", async () => {
    const service = serviceMock();
    const response = await createPropertyListHandler({ service, actorResolver: userResolver })(request(
      "/api/properties?q=Mission&type=MULTIFAMILY&status=archived&limit=10&offset=20",
    ));

    expect(response.status).toBe(200);
    expect(service.list).toHaveBeenCalledWith({
      q: "Mission",
      type: "MULTIFAMILY",
      status: "archived",
      limit: 10,
      offset: 20,
    });
    await expect(response.json()).resolves.toMatchObject({ summary: { activeTotal: 3, archivedTotal: 1 } });
  });

  it("creates a property for a non-admin user and injects the server actor", async () => {
    const service = serviceMock();
    const body = propertyDraft("VACANT_LAND");
    const response = await createPropertyCreateHandler({ service, actorResolver: userResolver })(jsonRequest(
      "/api/properties",
      "POST",
      body,
    ));

    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(actorId, body);
  });

  it("returns stable validation, not-found and unavailable errors", async () => {
    const service = serviceMock();
    const create = createPropertyCreateHandler({ service, actorResolver: userResolver });
    expect((await create(jsonRequest("/api/properties", "POST", { details: { type: "SINGLE_FAMILY" } }))).status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();

    service.get = vi.fn().mockResolvedValue(null);
    const missing = await createPropertyDetailHandler({ service, actorResolver: userResolver })(request(
      `/api/properties/${propertyId}`,
    ), context(propertyId));
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ error: { code: "property_not_found" } });

    service.list = vi.fn().mockRejectedValue(new Error("offline"));
    const unavailable = await createPropertyListHandler({ service, actorResolver: userResolver })(request("/api/properties"));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({ error: { code: "property_service_unavailable" } });
  });

  it("maps optimistic and destructive-unit conflicts", async () => {
    const service = serviceMock();
    service.update = vi.fn()
      .mockResolvedValueOnce({ status: "conflict", version: 4 })
      .mockResolvedValueOnce({ status: "unit_removal_confirmation_required", version: 4 });
    const update = createPropertyUpdateHandler({ service, actorResolver: userResolver });
    const body = { expectedVersion: 3, property: propertyDraft("MULTIFAMILY"), confirmUnitRemoval: false };

    const conflict = await update(jsonRequest(`/api/properties/${propertyId}`, "PATCH", body), context(propertyId));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ error: { code: "version_conflict", currentVersion: 4 } });

    const confirmation = await update(jsonRequest(`/api/properties/${propertyId}`, "PATCH", body), context(propertyId));
    expect(confirmation.status).toBe(409);
    await expect(confirmation.json()).resolves.toMatchObject({ error: { code: "unit_removal_confirmation_required" } });
  });

  it("archives and restores records without exposing deletion", async () => {
    const service = serviceMock();
    const archive = createPropertyArchiveHandler(true, { service, actorResolver: userResolver });
    const restore = createPropertyArchiveHandler(false, { service, actorResolver: userResolver });

    expect((await archive(versionedRequest("archive"), context(propertyId))).status).toBe(200);
    expect((await restore(versionedRequest("restore"), context(propertyId))).status).toBe(200);
    expect(service.setArchived).toHaveBeenNthCalledWith(1, {
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      archived: true,
    });
    expect(service.setArchived).toHaveBeenNthCalledWith(2, expect.objectContaining({ archived: false }));
  });

  it("streams private image bytes through an authenticated same-origin response", async () => {
    const service = serviceMock();
    const response = await createPropertyImageContentHandler({ service, actorResolver: userResolver })(request(
      `/api/properties/${propertyId}/images/${imageId}`,
    ), imageContext(propertyId, imageId));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
  });
});

function serviceMock() {
  return {
    list: vi.fn().mockResolvedValue(propertyListResponse()),
    get: vi.fn().mockResolvedValue(propertyDetail()),
    create: vi.fn().mockResolvedValue(propertyDetail()),
    update: vi.fn().mockResolvedValue({ status: "saved", property: propertyDetail() }),
    setArchived: vi.fn().mockResolvedValue({ status: "saved", property: propertyDetail() }),
    uploadImage: vi.fn(),
    loadImage: vi.fn().mockResolvedValue({
      metadata: { storagePath: "private.png", fileName: "front.png", mimeType: "image/png", sizeBytes: 3 },
      bytes: Uint8Array.from([1, 2, 3]),
    }),
    removeImage: vi.fn(),
  };
}

function request(path: string) {
  return new Request(`https://anda.test${path}`);
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`https://anda.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function versionedRequest(action: string) {
  return jsonRequest(`/api/properties/${propertyId}/${action}`, "POST", { expectedVersion: 1 });
}

function context(id: string) {
  return { params: Promise.resolve({ propertyId: id }) };
}

function imageContext(id: string, idOfImage: string) {
  return { params: Promise.resolve({ propertyId: id, imageId: idOfImage }) };
}
