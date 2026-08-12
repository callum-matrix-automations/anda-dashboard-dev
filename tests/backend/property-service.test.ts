import { describe, expect, it, vi } from "vitest";
import type { PropertyRepository } from "../../src/backend/repositories/properties/propertyRepository";
import type { PropertyImageStorage } from "../../src/backend/repositories/storage/propertyImageStorage";
import { PropertyServiceError, createPropertyService } from "../../src/backend/services/properties/propertyService";
import { actorId, imageId, propertyDetail, propertyId } from "../helpers/propertyFixtures";

describe("property service", () => {
  it("stores a verified image and records its private metadata", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const service = createPropertyService({ repository, storage });
    const bytes = pngBytes();

    await expect(service.uploadImage({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      fileName: "front.png",
      declaredMimeType: "image/png",
      bytes,
    })).resolves.toMatchObject({ status: "saved", propertyVersion: 2 });

    expect(storage.store).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringMatching(new RegExp(`^${propertyId}/[0-9a-f-]+\\.png$`, "u")),
      bytes,
      mimeType: "image/png",
    }));
    expect(repository.attachImage).toHaveBeenCalledWith(expect.objectContaining({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      fileName: "front.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
    }));
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when metadata attachment conflicts", async () => {
    const repository = repositoryMock();
    repository.attachImage = vi.fn().mockResolvedValue({ status: "conflict", version: 2 });
    const storage = storageMock();
    const service = createPropertyService({ repository, storage });

    await expect(service.uploadImage({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      fileName: "front.png",
      declaredMimeType: "image/png",
      bytes: pngBytes(),
    })).resolves.toEqual({ status: "conflict", version: 2 });

    expect(storage.remove).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${propertyId}/`, "u")));
  });

  it("compensates a repository failure and rejects spoofed image content", async () => {
    const repository = repositoryMock();
    repository.attachImage = vi.fn().mockRejectedValue(new Error("database offline"));
    const storage = storageMock();
    const service = createPropertyService({ repository, storage });

    await expect(service.uploadImage({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      fileName: "front.png",
      declaredMimeType: "image/png",
      bytes: pngBytes(),
    })).rejects.toThrow("database offline");
    expect(storage.remove).toHaveBeenCalledTimes(1);

    await expect(service.uploadImage({
      propertyId,
      expectedVersion: 1,
      actorProfileId: actorId,
      fileName: "fake.png",
      declaredMimeType: "image/png",
      bytes: new Uint8Array(20).fill(1),
    })).rejects.toMatchObject({ code: "unsupported_image_type" } satisfies Partial<PropertyServiceError>);
    expect(storage.store).toHaveBeenCalledTimes(1);
  });

  it("loads and removes private image content through the repository boundary", async () => {
    const repository = repositoryMock();
    const storage = storageMock();
    const service = createPropertyService({ repository, storage });

    await expect(service.loadImage(propertyId, imageId)).resolves.toMatchObject({
      metadata: { storagePath: `${propertyId}/${imageId}.png` },
      bytes: expect.any(Uint8Array),
    });
    await expect(service.removeImage({ propertyId, imageId, expectedVersion: 1, actorProfileId: actorId }))
      .resolves.toMatchObject({ status: "saved", propertyVersion: 2 });
    expect(storage.load).toHaveBeenCalledWith(`${propertyId}/${imageId}.png`);
    expect(storage.remove).toHaveBeenCalledWith(`${propertyId}/${imageId}.png`);
  });
});

function repositoryMock(): PropertyRepository {
  const image = {
    id: imageId,
    fileName: "front.png",
    mimeType: "image/png" as const,
    sizeBytes: pngBytes().byteLength,
    sortOrder: 0,
    createdBy: actorId,
    createdAt: "2026-08-12T12:00:00.000Z",
    contentUrl: `/api/properties/${propertyId}/images/${imageId}`,
  };
  return {
    list: vi.fn(),
    get: vi.fn().mockResolvedValue(propertyDetail()),
    create: vi.fn().mockResolvedValue(propertyDetail()),
    update: vi.fn().mockResolvedValue({ status: "saved", property: propertyDetail() }),
    setArchived: vi.fn().mockResolvedValue({ status: "saved", property: propertyDetail() }),
    attachImage: vi.fn().mockResolvedValue({ status: "saved", image, propertyVersion: 2 }),
    detachImage: vi.fn().mockResolvedValue({ status: "saved", storagePath: `${propertyId}/${imageId}.png`, propertyVersion: 2 }),
    getImageMetadata: vi.fn().mockResolvedValue({
      storagePath: `${propertyId}/${imageId}.png`,
      fileName: "front.png",
      mimeType: "image/png",
      sizeBytes: pngBytes().byteLength,
    }),
  };
}

function storageMock(): PropertyImageStorage {
  return {
    store: vi.fn().mockResolvedValue({ path: "stored.png" }),
    load: vi.fn().mockResolvedValue(pngBytes()),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function pngBytes() {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]);
}
