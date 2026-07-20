import { z } from "zod";
import type { MeetingArchiveRepository } from "../archive/meetingArchiveRepository";
import {
  MeetingArchiveClaimSchema,
  MeetingArchiveCompletionSchema,
  MeetingArchiveDetailSchema,
  MeetingArchiveFailurePersistenceSchema,
  MeetingArchiveQuerySchema,
  MeetingArchiveSearchResultSchema,
} from "../../../shared/contracts/meetingArchive";

interface Options {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const StoredArchiveRpcSchema = z.discriminatedUnion("status", [
  MeetingArchiveDetailSchema.extend({
    status: z.literal("available"),
    document: MeetingArchiveDetailSchema.shape.document.extend({
      path: z.string().trim().min(1),
    }),
  }).strict(),
  z.object({
    status: z.literal("not_found"),
    meetingId: z.string().uuid(),
  }).strict(),
]);

const RecoveryCandidatesSchema = z.array(z.string().uuid()).max(100);

export class MeetingArchiveRepositoryError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, { code = "archive_repository_failed", status, cause }: {
    code?: string;
    status?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "MeetingArchiveRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createSupabaseMeetingArchiveRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: Options = {}): MeetingArchiveRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey) {
      throw new MeetingArchiveRepositoryError("Supabase meeting archive persistence is not configured.", {
        code: "supabase_not_configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImplementation(new URL(`/rest/v1/rpc/${name}`, resolvedApiUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          apikey: resolvedSecretKey,
          authorization: `Bearer ${resolvedSecretKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new MeetingArchiveRepositoryError("Supabase meeting archive request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingArchiveRepositoryError(
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
    async claim(meetingId) {
      return parse(MeetingArchiveClaimSchema, await callRpc("claim_meeting_archive", {
        p_meeting_id: meetingId,
      }), "archive claim");
    },
    async complete(input) {
      return parse(MeetingArchiveCompletionSchema, await callRpc("complete_meeting_archive", {
        p_meeting_id: input.meetingId,
        p_run_id: input.runId,
        p_storage_path: input.storagePath,
        p_sha256: input.sha256,
        p_size_bytes: input.sizeBytes,
        p_page_count: input.pageCount,
      }), "archive completion");
    },
    async recordFailure(meetingId, runId, failure) {
      return parse(MeetingArchiveFailurePersistenceSchema, await callRpc("record_meeting_archive_failure", {
        p_meeting_id: meetingId,
        p_run_id: runId,
        p_error_code: failure.code,
        p_error_message: failure.message,
      }), "archive failure");
    },
    async listRecoveryCandidates(limit, maxAttempts) {
      const operational = maxAttempts !== undefined;
      return parse(RecoveryCandidatesSchema, await callRpc(
        operational
          ? "list_operational_archive_recovery_candidates"
          : "list_archive_recovery_candidates",
        operational
          ? { p_limit: limit, p_max_attempts: maxAttempts }
          : { p_limit: limit },
      ), "archive recovery candidates");
    },
    async search(query) {
      const input = MeetingArchiveQuerySchema.parse(query);
      return parse(MeetingArchiveSearchResultSchema, await callRpc("search_completed_meeting_archives", {
        p_query: input.query ?? null,
        p_year: input.year ?? null,
        p_category: input.category ?? null,
        p_limit: input.limit,
        p_offset: input.offset,
      }), "archive search result");
    },
    async get(meetingId) {
      const result = parse(StoredArchiveRpcSchema, await callRpc("get_completed_meeting_archive", {
        p_meeting_id: meetingId,
      }), "completed meeting archive");
      if (result.status === "not_found") return result;
      return {
        status: "available",
        archive: {
          meetingId: result.meetingId,
          title: result.title,
          meetingDate: result.meetingDate,
          category: result.category,
          tags: result.tags,
          signedBy: result.signedBy,
          signedAt: result.signedAt,
          signedPdfId: result.signedPdfId,
          completedAt: result.completedAt,
          version: result.version,
          minutes: result.minutes,
          motions: result.motions,
          document: {
            pdfId: result.document.pdfId,
            sha256: result.document.sha256,
            sizeBytes: result.document.sizeBytes,
            pageCount: result.document.pageCount,
            documentVersion: result.document.documentVersion,
          },
          storagePath: result.document.path,
        },
      };
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MeetingArchiveRepositoryError(`Supabase returned an invalid ${description}.`, {
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

export const supabaseMeetingArchiveRepository = createSupabaseMeetingArchiveRepository();
