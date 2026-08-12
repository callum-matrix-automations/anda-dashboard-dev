import { z } from "zod";
import type { PropertyImageStorage } from "../storage/propertyImageStorage";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

const DEFAULT_BUCKET = "property-images";
const SupabaseErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});

interface Options {
  apiUrl?: string;
  secretKey?: string;
  bucket?: string;
  fetchImplementation?: typeof fetch;
}

export class PropertyImageStorageError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, { code = "property_image_storage_failed", status, cause }: {
    code?: string;
    status?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "PropertyImageStorageError";
    this.code = code;
    this.status = status;
  }
}

export function createSupabasePropertyImageStorage({
  apiUrl,
  secretKey,
  bucket = DEFAULT_BUCKET,
  fetchImplementation = globalThis.fetch,
}: Options = {}): PropertyImageStorage {
  return {
    async store(input) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const response = await storageRequest(configuration, new URL(
        `/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(input.path)}`,
        configuration.apiUrl,
      ), {
        method: "POST",
        headers: supabaseServerHeaders(configuration.secretKey, {
          "content-type": input.mimeType,
          "x-upsert": "false",
          "cache-control": "private, max-age=300",
        }),
        body: Buffer.from(input.bytes),
      }, "upload");
      await assertStorageResponse(response, "upload");
      return { path: input.path };
    },
    async load(path) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const response = await storageRequest(configuration, new URL(
        `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(requiredPath(path))}`,
        configuration.apiUrl,
      ), {
        method: "GET",
        headers: supabaseServerHeaders(configuration.secretKey, { "cache-control": "no-store" }),
      }, "download");
      await assertStorageResponse(response, "download");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new PropertyImageStorageError("The stored property image is empty.", {
          code: "property_image_empty",
        });
      }
      return bytes;
    },
    async remove(path) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const response = await storageRequest(configuration, new URL(
        `/storage/v1/object/${encodeURIComponent(bucket)}`,
        configuration.apiUrl,
      ), {
        method: "DELETE",
        headers: supabaseServerHeaders(configuration.secretKey, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ prefixes: [requiredPath(path)] }),
      }, "removal");
      if (response.status !== 404) await assertStorageResponse(response, "removal");
    },
  };
}

async function storageRequest(
  configuration: ReturnType<typeof resolveConfiguration>,
  url: URL,
  init: RequestInit,
  operation: string,
) {
  try {
    return await configuration.fetchImplementation(url, init);
  } catch (error) {
    throw new PropertyImageStorageError(`Supabase property image ${operation} request failed.`, {
      code: `property_image_${operation}_request_failed`,
      cause: error,
    });
  }
}

async function assertStorageResponse(response: Response, operation: string) {
  if (response.ok) return;
  const body = await readResponseBody(response);
  const parsed = SupabaseErrorSchema.safeParse(body);
  throw new PropertyImageStorageError(
    parsed.success
      ? parsed.data.message ?? parsed.data.error ?? `Supabase rejected the property image ${operation}.`
      : `Supabase property image ${operation} returned HTTP ${response.status}.`,
    { status: response.status, code: `property_image_${operation}_failed` },
  );
}

function resolveConfiguration(
  apiUrl: string | undefined,
  secretKey: string | undefined,
  fetchImplementation: typeof fetch,
) {
  const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!resolvedApiUrl || !resolvedSecretKey) {
    throw new PropertyImageStorageError("Supabase property image storage is not configured.", {
      code: "property_image_storage_not_configured",
    });
  }
  return { apiUrl: resolvedApiUrl, secretKey: resolvedSecretKey, fetchImplementation };
}

function requiredPath(path: string) {
  const cleaned = path.trim();
  if (!cleaned) throw new PropertyImageStorageError("A property image path is required.");
  return cleaned;
}

function encodeObjectPath(path: string) {
  return requiredPath(path).split("/").map(encodeURIComponent).join("/");
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const supabasePropertyImageStorage = createSupabasePropertyImageStorage();
