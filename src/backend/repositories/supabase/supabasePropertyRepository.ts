import { z } from "zod";
import type { PropertyRepository } from "../properties/propertyRepository";
import {
  PropertyDetailSchema,
  PropertyImageMimeTypeSchema,
  PropertyImageSchema,
  PropertyListQuerySchema,
  PropertyListResponseSchema,
} from "../../../shared/contracts/property";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

interface Options {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const MutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), property: PropertyDetailSchema }).strict(),
  z.object({ status: z.literal("not_found"), version: z.null() }).strict(),
  z.object({ status: z.enum(["conflict", "archived", "invalid_state", "unit_removal_confirmation_required"]), version: z.number().int().positive() }).strict(),
]);

const ImageAttachResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), image: PropertyImageSchema, propertyVersion: z.number().int().positive() }).strict(),
  z.object({ status: z.literal("not_found"), version: z.null() }).strict(),
  z.object({ status: z.enum(["conflict", "archived", "image_limit"]), version: z.number().int().positive() }).strict(),
]);

const ImageDetachResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("saved"), storagePath: z.string().trim().min(1), propertyVersion: z.number().int().positive() }).strict(),
  z.object({ status: z.literal("not_found"), version: z.null() }).strict(),
  z.object({ status: z.enum(["conflict", "archived", "image_not_found"]), version: z.number().int().positive() }).strict(),
]);

const ImageMetadataSchema = z.object({
  storagePath: z.string().trim().min(1),
  fileName: z.string().trim().min(1),
  mimeType: PropertyImageMimeTypeSchema,
  sizeBytes: z.number().int().positive(),
}).strict();

export class PropertyRepositoryError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, { code = "property_repository_failed", status, cause }: {
    code?: string;
    status?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "PropertyRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createSupabasePropertyRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: Options = {}): PropertyRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey) {
      throw new PropertyRepositoryError("Supabase property persistence is not configured.", {
        code: "supabase_not_configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImplementation(new URL(`/rest/v1/rpc/${name}`, resolvedApiUrl), {
        method: "POST",
        headers: supabaseServerHeaders(resolvedSecretKey, {
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new PropertyRepositoryError("Supabase property request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new PropertyRepositoryError(
        details.success ? details.data.message : `Supabase returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code ?? "supabase_response_failed" : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async list(query) {
      const input = PropertyListQuerySchema.parse(query);
      return parse(PropertyListResponseSchema, await callRpc("list_properties", {
        p_query: input.q,
        p_type: input.type,
        p_status: input.status,
        p_limit: input.limit,
        p_offset: input.offset,
      }), "property list");
    },
    async get(propertyId) {
      const response = await callRpc("property_detail_json", { p_property_id: propertyId });
      if (response === null) return null;
      return parse(PropertyDetailSchema, response, "property detail");
    },
    async create(actorProfileId, property) {
      return parse(PropertyDetailSchema, await callRpc("create_property", {
        p_actor_id: actorProfileId,
        p_property: property,
      }), "created property");
    },
    async update(input) {
      return parse(MutationResultSchema, await callRpc("update_property", {
        p_property_id: input.propertyId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_property: input.property,
        p_confirm_unit_removal: input.confirmUnitRemoval,
      }), "property update result");
    },
    async setArchived(input) {
      return parse(MutationResultSchema, await callRpc("set_property_archived", {
        p_property_id: input.propertyId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_archived: input.archived,
      }), "property archive result");
    },
    async attachImage(input) {
      return parse(ImageAttachResultSchema, await callRpc("attach_property_image", {
        p_property_id: input.propertyId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
        p_image_id: input.imageId,
        p_storage_path: input.storagePath,
        p_file_name: input.fileName,
        p_mime_type: input.mimeType,
        p_size_bytes: input.sizeBytes,
      }), "property image result");
    },
    async detachImage(input) {
      return parse(ImageDetachResultSchema, await callRpc("detach_property_image", {
        p_property_id: input.propertyId,
        p_image_id: input.imageId,
        p_expected_version: input.expectedVersion,
        p_actor_id: input.actorProfileId,
      }), "property image removal result");
    },
    async getImageMetadata(propertyId, imageId) {
      const response = await callRpc("get_property_image_metadata", {
        p_property_id: propertyId,
        p_image_id: imageId,
      });
      if (response === null) return null;
      return parse(ImageMetadataSchema, response, "property image metadata");
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PropertyRepositoryError(`Supabase returned an invalid ${description}.`, {
      code: "invalid_supabase_response",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export const supabasePropertyRepository = createSupabasePropertyRepository();
