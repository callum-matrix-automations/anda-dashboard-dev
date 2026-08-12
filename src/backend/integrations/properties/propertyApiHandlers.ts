import { z } from "zod";
import type { ServerActorResolver } from "../../auth/serverActor";
import { resolveServerActor } from "../../auth/serverActor";
import { PropertyRepositoryError } from "../../repositories/supabase/supabasePropertyRepository";
import { PropertyImageStorageError } from "../../repositories/supabase/supabasePropertyImageStorage";
import { PropertyServiceError, createPropertyService, propertyService } from "../../services/properties/propertyService";
import { apiError, apiValidationError, requireCurrentServerActor } from "../http/apiResponses";
import {
  PropertyDraftSchema,
  PropertyListQuerySchema,
  PropertyUpdateRequestSchema,
  PropertyVersionedRequestSchema,
} from "../../../shared/contracts/property";

type RouteContext = { params: Promise<{ propertyId: string }> };
type ImageRouteContext = { params: Promise<{ propertyId: string; imageId: string }> };
type PropertyService = ReturnType<typeof createPropertyService>;

interface Dependencies {
  service?: PropertyService;
  actorResolver?: ServerActorResolver;
}

const IdSchema = z.string().uuid();

export function createPropertyListHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;

    const url = new URL(request.url);
    const parsed = PropertyListQuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      type: url.searchParams.get("type") || undefined,
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) return apiValidationError(parsed.error, "The property filters are invalid.");

    try {
      return Response.json(await service.list(parsed.data));
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyCreateHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = PropertyDraftSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The property details are invalid.");

    try {
      return Response.json(await service.create(access.actor.profileId, parsed.data), { status: 201 });
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyDetailHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request, context: RouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const propertyId = await routeId(context);
    if (propertyId instanceof Response) return propertyId;

    try {
      const property = await service.get(propertyId);
      return property
        ? Response.json(property)
        : apiError(404, "property_not_found", "The property was not found.");
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyUpdateHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function PATCH(request: Request, context: RouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const propertyId = await routeId(context);
    if (propertyId instanceof Response) return propertyId;

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = PropertyUpdateRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The property update is invalid.");

    try {
      const result = await service.update({
        propertyId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
        property: parsed.data.property,
        confirmUnitRemoval: parsed.data.confirmUnitRemoval,
      });
      return propertyMutationResponse(result);
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyArchiveHandler(archived: boolean, {
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request, context: RouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const propertyId = await routeId(context);
    if (propertyId instanceof Response) return propertyId;

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = PropertyVersionedRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The property version is invalid.");

    try {
      const result = await service.setArchived({
        propertyId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
        archived,
      });
      return propertyMutationResponse(result);
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyImageUploadHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function POST(request: Request, context: RouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const propertyId = await routeId(context);
    if (propertyId instanceof Response) return propertyId;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError(400, "invalid_request", "Upload one property image using multipart form data.");
    }
    const file = form.get("file");
    const expectedVersion = Number(form.get("expectedVersion"));
    if (!(file instanceof File)) {
      return apiError(400, "invalid_request", "Choose a property image to upload.");
    }
    const parsedVersion = z.number().int().positive().safeParse(expectedVersion);
    if (!parsedVersion.success) return apiValidationError(parsedVersion.error, "The property version is invalid.");

    try {
      const result = await service.uploadImage({
        propertyId,
        expectedVersion: parsedVersion.data,
        actorProfileId: access.actor.profileId,
        fileName: file.name,
        declaredMimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (result.status === "saved") {
        return Response.json({ image: result.image, propertyVersion: result.propertyVersion }, { status: 201 });
      }
      return imageAttachResponse(result);
    } catch (error) {
      return imageError(error);
    }
  };
}

export function createPropertyImageContentHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function GET(request: Request, context: ImageRouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const ids = await imageRouteIds(context);
    if (ids instanceof Response) return ids;

    try {
      const image = await service.loadImage(ids.propertyId, ids.imageId);
      if (!image) return apiError(404, "property_image_not_found", "The property image was not found.");
      return new Response(Buffer.from(image.bytes), {
        headers: {
          "content-type": image.metadata.mimeType,
          "content-length": String(image.metadata.sizeBytes),
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.metadata.fileName)}`,
          "cache-control": "private, max-age=300",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      return unavailable(error);
    }
  };
}

export function createPropertyImageDeleteHandler({
  service = propertyService,
  actorResolver = resolveServerActor,
}: Dependencies = {}) {
  return async function DELETE(request: Request, context: ImageRouteContext) {
    const access = await requireCurrentServerActor(request, actorResolver);
    if ("response" in access) return access.response;
    const ids = await imageRouteIds(context);
    if (ids instanceof Response) return ids;

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const parsed = PropertyVersionedRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "The property version is invalid.");

    try {
      const result = await service.removeImage({
        propertyId: ids.propertyId,
        imageId: ids.imageId,
        expectedVersion: parsed.data.expectedVersion,
        actorProfileId: access.actor.profileId,
      });
      if (result.status === "saved") {
        return Response.json({ image: null, propertyVersion: result.propertyVersion });
      }
      if (result.status === "image_not_found") {
        return apiError(404, "property_image_not_found", "The property image was not found.");
      }
      return imageAttachResponse(result);
    } catch (error) {
      return unavailable(error);
    }
  };
}

async function routeId(context: RouteContext): Promise<string | Response> {
  const parsed = IdSchema.safeParse((await context.params).propertyId);
  return parsed.success
    ? parsed.data
    : apiError(400, "invalid_property_id", "The property ID is invalid.");
}

async function imageRouteIds(context: ImageRouteContext) {
  const params = await context.params;
  const propertyId = IdSchema.safeParse(params.propertyId);
  const imageId = IdSchema.safeParse(params.imageId);
  if (!propertyId.success || !imageId.success) {
    return apiError(400, "invalid_property_image_id", "The property or image ID is invalid.");
  }
  return { propertyId: propertyId.data, imageId: imageId.data };
}

async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return apiError(400, "invalid_json", "The request body must be valid JSON.");
  }
}

function propertyMutationResponse(result: Awaited<ReturnType<PropertyService["update"]>>) {
  if (result.status === "saved") return Response.json(result.property);
  if (result.status === "not_found") return apiError(404, "property_not_found", "The property was not found.");
  if (result.status === "conflict") {
    return apiError(409, "version_conflict", "The property changed since it was opened. Reload and try again.", {
      currentVersion: result.version,
    });
  }
  if (result.status === "unit_removal_confirmation_required") {
    return apiError(409, "unit_removal_confirmation_required", "Confirm that the removed multifamily units should be deleted.", {
      currentVersion: result.version,
    });
  }
  if (result.status === "archived") {
    return apiError(409, "property_archived", "Restore the property before editing it.", { currentVersion: result.version });
  }
  return apiError(409, "invalid_property_state", "The property is already in the requested state.", {
    currentVersion: result.version,
  });
}

function imageAttachResponse(result: { status: string; version: number | null }) {
  if (result.status === "not_found") return apiError(404, "property_not_found", "The property was not found.");
  if (result.status === "conflict") {
    return apiError(409, "version_conflict", "The property changed since it was opened. Reload and try again.", {
      currentVersion: result.version,
    });
  }
  if (result.status === "archived") {
    return apiError(409, "property_archived", "Restore the property before changing its images.", {
      currentVersion: result.version,
    });
  }
  return apiError(409, "property_image_limit", "A property can have up to 10 images.", {
    currentVersion: result.version,
  });
}

function imageError(error: unknown) {
  if (error instanceof PropertyServiceError) {
    if (error.code === "image_too_large") return apiError(413, error.code, error.message);
    if (error.code === "unsupported_image_type") return apiError(415, error.code, error.message);
    if (error.code === "invalid_image" || error.code === "invalid_image_filename") {
      return apiError(400, error.code, error.message);
    }
  }
  return unavailable(error);
}

function unavailable(error: unknown) {
  if (
    error instanceof PropertyRepositoryError
    || error instanceof PropertyImageStorageError
    || error instanceof PropertyServiceError
  ) {
    return apiError(503, error.code, "The Property Centre is temporarily unavailable.");
  }
  return apiError(503, "property_service_unavailable", "The Property Centre is temporarily unavailable.");
}
