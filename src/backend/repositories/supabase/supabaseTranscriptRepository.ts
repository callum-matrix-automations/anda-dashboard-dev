import { z } from "zod";
import type {
  StoredTranscriptImport,
  TranscriptImportRecord,
  TranscriptRepository,
} from "../transcripts/transcriptRepository";

const TranscriptImportRpcRowSchema = z.object({
  ingestion_status: z.enum(["received", "duplicate"]),
  meeting_id: z.string().uuid(),
  transcript_id: z.string().uuid(),
  imported_at: z.string().datetime({ offset: true }),
});

interface SupabaseTranscriptRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

export class TranscriptRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = "TranscriptRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseTranscriptRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseTranscriptRepositoryOptions = {}): TranscriptRepository {
  return {
    async storeImport(record: TranscriptImportRecord): Promise<StoredTranscriptImport> {
      const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
      const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
      if (!resolvedApiUrl || !resolvedSecretKey) {
        throw new TranscriptRepositoryError("Supabase transcript persistence is not configured.", {
          code: "supabase_not_configured",
        });
      }
      if (typeof fetchImplementation !== "function") {
        throw new TranscriptRepositoryError("A fetch implementation is required for Supabase persistence.", {
          code: "fetch_not_configured",
        });
      }

      const rpcUrl = new URL("/rest/v1/rpc/ingest_transcript_webhook", resolvedApiUrl);
      let response: Response;
      try {
        response = await fetchImplementation(rpcUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            apikey: resolvedSecretKey,
            authorization: `Bearer ${resolvedSecretKey}`,
          },
          body: JSON.stringify({
            p_source_meeting_id: record.sourceMeetingId,
            p_title: record.title,
            p_meeting_date: record.meetingDate,
            p_source_transcript_id: record.sourceTranscriptId,
            p_content: record.content,
          }),
        });
      } catch (error) {
        throw new TranscriptRepositoryError("Supabase transcript persistence request failed.", {
          code: "supabase_request_failed",
          cause: error,
        });
      }

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        const details = SupabaseErrorSchema.safeParse(responseBody);
        throw new TranscriptRepositoryError(
          details.success ? details.data.message : `Supabase transcript persistence returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: details.success ? details.data.code : "supabase_response_failed",
          },
        );
      }

      const parsed = z.array(TranscriptImportRpcRowSchema).length(1).safeParse(responseBody);
      if (!parsed.success) {
        throw new TranscriptRepositoryError("Supabase returned an invalid transcript persistence response.", {
          status: response.status,
          code: "invalid_supabase_response",
        });
      }

      const stored = parsed.data[0];
      if (!stored) {
        throw new TranscriptRepositoryError("Supabase returned an empty transcript persistence response.", {
          status: response.status,
          code: "invalid_supabase_response",
        });
      }
      return {
        status: stored.ingestion_status === "received" ? "stored" : "duplicate",
        meetingId: stored.meeting_id,
        transcriptId: stored.transcript_id,
        importedAt: stored.imported_at,
      };
    },
  };
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export const supabaseTranscriptRepository = createSupabaseTranscriptRepository();
