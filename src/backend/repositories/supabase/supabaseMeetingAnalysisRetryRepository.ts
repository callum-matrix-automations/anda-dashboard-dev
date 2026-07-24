import { z } from "zod";
import type { MeetingAnalysisRetryRepository } from "../analysis/meetingAnalysisRetryRepository";
import {
  PrepareMeetingAnalysisRetryResultSchema,
} from "../../../shared/contracts/meetingAnalysisRetry";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

interface SupabaseMeetingAnalysisRetryRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

export class MeetingAnalysisRetryRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: {
    status?: number;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "MeetingAnalysisRetryRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMeetingAnalysisRetryRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseMeetingAnalysisRetryRepositoryOptions = {}): MeetingAnalysisRetryRepository {
  return {
    async prepareRetry(command) {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const rpcUrl = new URL("/rest/v1/rpc/prepare_meeting_analysis_retry", configuration.apiUrl);
      let response: Response;
      try {
        response = await configuration.fetchImplementation(rpcUrl, {
          method: "POST",
          headers: supabaseServerHeaders(configuration.secretKey, {
            "content-type": "application/json",
            accept: "application/json",
          }),
          body: JSON.stringify({
            p_meeting_id: command.meetingId,
            p_expected_version: command.expectedVersion,
            p_actor_profile_id: command.actorProfileId,
          }),
        });
      } catch (error) {
        throw new MeetingAnalysisRetryRepositoryError("Supabase meeting analysis retry request failed.", {
          code: "supabase_request_failed",
          cause: error,
        });
      }

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        const details = SupabaseErrorSchema.safeParse(responseBody);
        throw new MeetingAnalysisRetryRepositoryError(
          details.success ? details.data.message : `Supabase meeting analysis retry returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: details.success ? details.data.code : "supabase_response_failed",
          },
        );
      }

      const parsed = PrepareMeetingAnalysisRetryResultSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingAnalysisRetryRepositoryError("Supabase returned an invalid meeting analysis retry result.", {
          code: "invalid_supabase_response",
          cause: parsed.error,
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
    throw new MeetingAnalysisRetryRepositoryError("Supabase meeting analysis retry is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new MeetingAnalysisRetryRepositoryError("A fetch implementation is required for analysis retry.", {
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

export const supabaseMeetingAnalysisRetryRepository = createSupabaseMeetingAnalysisRetryRepository();
