import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApprovedPdfSource } from "../storage/approvedPdfSource";
import type { MeetingArchiveStorage } from "../storage/meetingArchiveStorage";
import type { MinutesPdfStorage } from "../storage/minutesPdfStorage";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

const DEFAULT_BUCKET = "meeting-minutes";
const SupabaseErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
});
const SupabaseSignedUrlSchema = z.object({
  signedURL: z.string().trim().min(1),
});

interface SupabaseMinutesPdfStorageOptions {
  apiUrl?: string;
  secretKey?: string;
  bucket?: string;
  fetchImplementation?: typeof fetch;
}

export class MinutesPdfStorageError extends Error {
  readonly status?: number;
  readonly code: string;

  constructor(message: string, { status, code = "pdf_storage_failed", cause }: {
    status?: number;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "MinutesPdfStorageError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMinutesPdfStorage({
  apiUrl,
  secretKey,
  bucket = DEFAULT_BUCKET,
  fetchImplementation = globalThis.fetch,
}: SupabaseMinutesPdfStorageOptions = {}): MinutesPdfStorage & ApprovedPdfSource & MeetingArchiveStorage {
  async function uploadPdf(objectPath: string, bytes: Uint8Array) {
    const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
    const encodedPath = encodeObjectPath(objectPath);
    const uploadUrl = new URL(
      `/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
      configuration.apiUrl,
    );
    let response: Response;
    try {
      response = await configuration.fetchImplementation(uploadUrl, {
        method: "POST",
        headers: supabaseServerHeaders(configuration.secretKey, {
          "content-type": "application/pdf",
          "x-upsert": "true",
          "cache-control": "no-store",
        }),
        body: Buffer.from(bytes),
      });
    } catch (error) {
      throw new MinutesPdfStorageError("Supabase PDF upload request failed.", {
        code: "pdf_storage_request_failed",
        cause: error,
      });
    }

    if (!response.ok) {
      const body = await readResponseBody(response);
      const details = SupabaseErrorSchema.safeParse(body);
      throw new MinutesPdfStorageError(
        details.success
          ? details.data.message ?? details.data.error ?? "Supabase rejected the PDF upload."
          : `Supabase PDF storage returned HTTP ${response.status}.`,
        { status: response.status },
      );
    }
  }

  return {
    async storeUnsignedPdf(input) {
      const objectPath = `unsigned/${input.meetingId}/v${input.documentVersion}/minutes.pdf`;
      await uploadPdf(objectPath, input.bytes);

      return {
        path: objectPath,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        sizeBytes: input.bytes.byteLength,
        pageCount: input.pageCount,
      };
    },

    async storeSignedPdf(input) {
      const objectPath = `signed/${input.meetingId}/v${input.documentVersion}/minutes-signed.pdf`;
      await uploadPdf(objectPath, input.bytes);
      return {
        path: objectPath,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        sizeBytes: input.bytes.byteLength,
        pageCount: input.pageCount,
      };
    },

    async removeObject(path) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const cleanedPath = requiredPath(path);
      let response: Response;
      try {
        response = await configuration.fetchImplementation(new URL(
          `/storage/v1/object/${encodeURIComponent(bucket)}`,
          configuration.apiUrl,
        ), {
          method: "DELETE",
          headers: supabaseServerHeaders(configuration.secretKey, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ prefixes: [cleanedPath] }),
        });
      } catch (error) {
        throw new MinutesPdfStorageError("Supabase PDF removal request failed.", {
          code: "pdf_storage_removal_request_failed",
          cause: error,
        });
      }
      if (!response.ok && response.status !== 404) {
        throw new MinutesPdfStorageError(`Supabase PDF removal returned HTTP ${response.status}.`, {
          status: response.status,
          code: "pdf_storage_removal_failed",
        });
      }
    },

    async createTemporaryDownload(path, expiresInSeconds) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const cleanedPath = requiredPath(path);
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 3_600) {
        throw new MinutesPdfStorageError("The signed PDF access lifetime is invalid.", {
          code: "pdf_storage_invalid_expiry",
        });
      }
      let response: Response;
      try {
        response = await configuration.fetchImplementation(new URL(
          `/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectPath(cleanedPath)}`,
          configuration.apiUrl,
        ), {
          method: "POST",
          headers: supabaseServerHeaders(configuration.secretKey, {
            "content-type": "application/json",
          }),
          body: JSON.stringify({ expiresIn: expiresInSeconds }),
        });
      } catch (error) {
        throw new MinutesPdfStorageError("Supabase signed URL request failed.", {
          code: "pdf_storage_signed_url_request_failed",
          cause: error,
        });
      }
      const body = await readResponseBody(response);
      const signed = SupabaseSignedUrlSchema.safeParse(body);
      if (!response.ok || !signed.success) {
        throw new MinutesPdfStorageError(`Supabase signed URL request returned HTTP ${response.status}.`, {
          status: response.status,
          code: "pdf_storage_signed_url_failed",
        });
      }
      return {
        url: normaliseSignedUrl(signed.data.signedURL, configuration.apiUrl),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1_000).toISOString(),
      };
    },

    async loadApprovedPdf(path) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const cleanedPath = requiredPath(path);
      const encodedPath = encodeObjectPath(cleanedPath);
      const downloadUrl = new URL(
        `/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodedPath}`,
        configuration.apiUrl,
      );
      let response: Response;
      try {
        response = await configuration.fetchImplementation(downloadUrl, {
          method: "GET",
          headers: supabaseServerHeaders(configuration.secretKey, {
            accept: "application/pdf",
            "cache-control": "no-store",
          }),
        });
      } catch (error) {
        throw new MinutesPdfStorageError("Supabase PDF download request failed.", {
          code: "pdf_storage_download_request_failed",
          cause: error,
        });
      }

      if (!response.ok) {
        throw new MinutesPdfStorageError(
          `Supabase PDF download returned HTTP ${response.status}.`,
          { status: response.status, code: "pdf_storage_download_failed" },
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new MinutesPdfStorageError("The approved PDF stored in Supabase is empty.", {
          code: "pdf_storage_empty_document",
        });
      }
      return bytes;
    },
  };
}

function requiredPath(path: string) {
  const cleanedPath = path.trim();
  if (!cleanedPath) {
    throw new MinutesPdfStorageError("A PDF storage path is required.", {
      code: "pdf_storage_invalid_path",
    });
  }
  return cleanedPath;
}

function encodeObjectPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function normaliseSignedUrl(value: string, apiUrl: string) {
  if (/^https?:\/\//iu.test(value)) return value;
  const path = value.startsWith("/object/") ? `/storage/v1${value}` : value;
  return new URL(path, apiUrl).href;
}

function resolveConfiguration(
  apiUrl: string | undefined,
  secretKey: string | undefined,
  fetchImplementation: typeof fetch,
) {
  const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!resolvedApiUrl || !resolvedSecretKey) {
    throw new MinutesPdfStorageError("Supabase PDF storage is not configured.", {
      code: "pdf_storage_not_configured",
    });
  }
  return { apiUrl: resolvedApiUrl, secretKey: resolvedSecretKey, fetchImplementation };
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

export const supabaseMinutesPdfStorage = createSupabaseMinutesPdfStorage();
