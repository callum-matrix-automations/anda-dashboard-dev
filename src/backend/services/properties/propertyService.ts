import { randomUUID } from "node:crypto";
import type { PropertyRepository } from "../../repositories/properties/propertyRepository";
import type { PropertyImageStorage } from "../../repositories/storage/propertyImageStorage";
import { supabasePropertyRepository } from "../../repositories/supabase/supabasePropertyRepository";
import { supabasePropertyImageStorage } from "../../repositories/supabase/supabasePropertyImageStorage";
import {
  PROPERTY_IMAGE_MAX_BYTES,
  type PropertyDraft,
  type PropertyImageMimeType,
  type PropertyListQuery,
} from "../../../shared/contracts/property";

export class PropertyServiceError extends Error {
  readonly code: string;

  constructor(message: string, { code = "property_service_failed", cause }: {
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "PropertyServiceError";
    this.code = code;
  }
}

export function createPropertyService({
  repository = supabasePropertyRepository,
  storage = supabasePropertyImageStorage,
}: {
  repository?: PropertyRepository;
  storage?: PropertyImageStorage;
} = {}) {
  return {
    list(query: PropertyListQuery) {
      return repository.list(query);
    },
    get(propertyId: string) {
      return repository.get(propertyId);
    },
    create(actorProfileId: string, property: PropertyDraft) {
      return repository.create(actorProfileId, property);
    },
    update(input: {
      propertyId: string;
      expectedVersion: number;
      actorProfileId: string;
      property: PropertyDraft;
      confirmUnitRemoval: boolean;
    }) {
      return repository.update(input);
    },
    setArchived(input: {
      propertyId: string;
      expectedVersion: number;
      actorProfileId: string;
      archived: boolean;
    }) {
      return repository.setArchived(input);
    },
    async uploadImage(input: {
      propertyId: string;
      expectedVersion: number;
      actorProfileId: string;
      fileName: string;
      declaredMimeType: string;
      bytes: Uint8Array;
    }) {
      const fileName = validateFileName(input.fileName);
      const mimeType = validateImage(input.declaredMimeType, input.bytes);
      const imageId = randomUUID();
      const storagePath = `${input.propertyId}/${imageId}.${extensionFor(mimeType)}`;
      await storage.store({ path: storagePath, bytes: input.bytes, mimeType });

      let result;
      try {
        result = await repository.attachImage({
          propertyId: input.propertyId,
          expectedVersion: input.expectedVersion,
          actorProfileId: input.actorProfileId,
          imageId,
          storagePath,
          fileName,
          mimeType,
          sizeBytes: input.bytes.byteLength,
        });
      } catch (error) {
        await cleanupUpload(storage, storagePath);
        throw error;
      }

      if (result.status !== "saved") {
        await cleanupUpload(storage, storagePath);
      }
      return result;
    },
    async loadImage(propertyId: string, imageId: string) {
      const metadata = await repository.getImageMetadata(propertyId, imageId);
      if (!metadata) return null;
      return { metadata, bytes: await storage.load(metadata.storagePath) };
    },
    async removeImage(input: {
      propertyId: string;
      imageId: string;
      expectedVersion: number;
      actorProfileId: string;
    }) {
      const result = await repository.detachImage(input);
      if (result.status === "saved") await storage.remove(result.storagePath);
      return result;
    },
  };
}

async function cleanupUpload(
  storage: PropertyImageStorage,
  storagePath: string,
): Promise<void> {
  try {
    await storage.remove(storagePath);
  } catch (cleanupError) {
    throw new PropertyServiceError("The property image upload failed and cleanup was unsuccessful.", {
      code: "property_image_cleanup_failed",
      cause: cleanupError,
    });
  }
}

function validateFileName(value: string) {
  const fileName = value.trim();
  if (!fileName || fileName.length > 255) {
    throw new PropertyServiceError("The property image filename is invalid.", {
      code: "invalid_image_filename",
    });
  }
  return fileName;
}

function validateImage(declaredMimeType: string, bytes: Uint8Array): PropertyImageMimeType {
  if (bytes.byteLength < 12 || bytes.byteLength > PROPERTY_IMAGE_MAX_BYTES) {
    throw new PropertyServiceError(
      bytes.byteLength > PROPERTY_IMAGE_MAX_BYTES
        ? "Property images must be 10 MB or smaller."
        : "The property image is empty or invalid.",
      { code: bytes.byteLength > PROPERTY_IMAGE_MAX_BYTES ? "image_too_large" : "invalid_image" },
    );
  }

  const detected = detectMimeType(bytes);
  if (!detected || detected !== declaredMimeType) {
    throw new PropertyServiceError("Upload a valid JPEG, PNG or WebP image.", {
      code: "unsupported_image_type",
    });
  }
  return detected;
}

function detectMimeType(bytes: Uint8Array): PropertyImageMimeType | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function extensionFor(mimeType: PropertyImageMimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export const propertyService = createPropertyService();
