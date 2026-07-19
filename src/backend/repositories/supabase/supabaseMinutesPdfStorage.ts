import { createHash } from "node:crypto";
import { z } from "zod";
import type { MinutesPdfStorage } from "../storage/minutesPdfStorage";

const DEFAULT_BUCKET = "meeting-minutes";
const SupabaseErrorSchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
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
}: SupabaseMinutesPdfStorageOptions = {}): MinutesPdfStorage {
  return {
    async storeUnsignedPdf(input) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const objectPath = `unsigned/${input.meetingId}/v${input.documentVersion}/minutes.pdf`;
      const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
      const uploadUrl = new URL(
        `/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`,
        configuration.apiUrl,
      );
      let response: Response;
      try {
        response = await configuration.fetchImplementation(uploadUrl, {
          method: "POST",
          headers: {
            "content-type": "application/pdf",
            apikey: configuration.secretKey,
            authorization: `Bearer ${configuration.secretKey}`,
            "x-upsert": "true",
            "cache-control": "no-store",
          },
          body: Buffer.from(input.bytes),
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

      return {
        path: objectPath,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        sizeBytes: input.bytes.byteLength,
        pageCount: input.pageCount,
      };
    },
  };
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
