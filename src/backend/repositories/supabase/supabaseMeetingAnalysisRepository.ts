import { z } from "zod";
import {
  ANALYSIS_CLAIM_STATUSES,
  type AnalysisFailure,
  type AnalysisFailureStatus,
  type DraftPersistenceStatus,
  type MeetingAnalysisClaim,
  type MeetingAnalysisRepository,
} from "../analysis/meetingAnalysisRepository";
import {
  MeetingAnalysisInputSchema,
  type MeetingDraft,
} from "../../../shared/contracts/meetingAnalysis";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

const AnalysisClaimRowSchema = z.object({
  claim_status: z.enum(ANALYSIS_CLAIM_STATUSES),
  run_id: z.string().uuid().nullable(),
  attempt_number: z.number().int().min(0).max(3).nullable(),
  analysis_input: z.unknown().nullable(),
});

const DraftPersistenceStatusSchema = z.enum(["saved", "not_found", "protected", "stale"]);
const AnalysisFailureStatusSchema = z.enum(["retry_scheduled", "failed", "not_found", "protected", "stale"]);
const HumanOwnershipStatusSchema = z.enum(["marked", "not_found"]);
const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

interface SupabaseMeetingAnalysisRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

export class MeetingAnalysisRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = "MeetingAnalysisRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMeetingAnalysisRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseMeetingAnalysisRepositoryOptions = {}): MeetingAnalysisRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
    const rpcUrl = new URL(`/rest/v1/rpc/${name}`, configuration.apiUrl);
    let response: Response;
    try {
      response = await configuration.fetchImplementation(rpcUrl, {
        method: "POST",
        headers: supabaseServerHeaders(configuration.secretKey, {
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new MeetingAnalysisRepositoryError("Supabase meeting analysis request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingAnalysisRepositoryError(
        details.success ? details.data.message : `Supabase meeting analysis returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async claimAnalysis(meetingId, { manualRetry = false } = {}): Promise<MeetingAnalysisClaim> {
      const responseBody = await callRpc("claim_meeting_analysis", {
        p_meeting_id: meetingId,
        p_manual_retry: manualRetry,
      });
      const parsed = z.array(AnalysisClaimRowSchema).length(1).safeParse(responseBody);
      if (!parsed.success || !parsed.data[0]) {
        throw new MeetingAnalysisRepositoryError("Supabase returned an invalid meeting analysis claim.", {
          code: "invalid_supabase_response",
        });
      }

      const row = parsed.data[0];
      if (row.claim_status !== "claimed") {
        return {
          status: row.claim_status,
          meetingId,
          attempt: row.attempt_number,
          ...(row.run_id ? { runId: row.run_id } : {}),
        };
      }

      const input = MeetingAnalysisInputSchema.safeParse(row.analysis_input);
      if (!row.run_id || row.attempt_number === null || !input.success) {
        throw new MeetingAnalysisRepositoryError("Supabase returned incomplete claimed analysis input.", {
          code: "invalid_supabase_response",
          cause: input.success ? undefined : input.error,
        });
      }

      return {
        status: "claimed",
        meetingId,
        runId: row.run_id,
        attempt: row.attempt_number,
        input: input.data,
      };
    },

    async persistDraft(meetingId, runId, draft: MeetingDraft): Promise<DraftPersistenceStatus> {
      const responseBody = await callRpc("persist_meeting_analysis_draft", {
        p_meeting_id: meetingId,
        p_run_id: runId,
        p_draft: draft,
      });
      const parsed = DraftPersistenceStatusSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingAnalysisRepositoryError("Supabase returned an invalid draft persistence result.", {
          code: "invalid_supabase_response",
        });
      }
      return parsed.data;
    },

    async recordFailure(meetingId, runId, failure: AnalysisFailure): Promise<AnalysisFailureStatus> {
      const responseBody = await callRpc("record_meeting_analysis_failure", {
        p_meeting_id: meetingId,
        p_run_id: runId,
        p_error_code: failure.code,
        p_error_message: failure.message,
      });
      const parsed = AnalysisFailureStatusSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingAnalysisRepositoryError("Supabase returned an invalid analysis failure result.", {
          code: "invalid_supabase_response",
        });
      }
      return parsed.data;
    },

    async markHumanOwned(meetingId) {
      const responseBody = await callRpc("mark_meeting_human_owned", {
        p_meeting_id: meetingId,
      });
      const parsed = HumanOwnershipStatusSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingAnalysisRepositoryError("Supabase returned an invalid human ownership result.", {
          code: "invalid_supabase_response",
        });
      }
      return parsed.data;
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
    throw new MeetingAnalysisRepositoryError("Supabase meeting analysis is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new MeetingAnalysisRepositoryError("A fetch implementation is required for Supabase analysis persistence.", {
      code: "fetch_not_configured",
    });
  }
  return {
    apiUrl: resolvedApiUrl,
    secretKey: resolvedSecretKey,
    fetchImplementation,
  };
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

export const supabaseMeetingAnalysisRepository = createSupabaseMeetingAnalysisRepository();
