import { z } from "zod";
import type { MeetingSigningRepository } from "../signing/meetingSigningRepository";
import {
  MeetingSigningClaimSchema,
  MeetingSigningCreationStatusSchema,
  MeetingSigningFailureStatusSchema,
  MeetingSigningPersistenceStatusSchema,
  MeetingSigningRetryResultSchema,
} from "../../../shared/contracts/meetingSigning";

interface SupabaseMeetingSigningRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

export class MeetingSigningRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: {
    status?: number;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "MeetingSigningRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMeetingSigningRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseMeetingSigningRepositoryOptions = {}): MeetingSigningRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
    const rpcUrl = new URL(`/rest/v1/rpc/${name}`, configuration.apiUrl);
    let response: Response;
    try {
      response = await configuration.fetchImplementation(rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          apikey: configuration.secretKey,
          authorization: `Bearer ${configuration.secretKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new MeetingSigningRepositoryError("Supabase meeting signing request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingSigningRepositoryError(
        details.success
          ? details.data.message
          : `Supabase meeting signing returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async claimDelivery(meetingId) {
      return parseResponse(
        MeetingSigningClaimSchema,
        await callRpc("claim_meeting_signing_delivery", { p_meeting_id: meetingId }),
        "signing delivery claim",
      );
    },

    async recordRequestCreated(meetingId, runId, externalRequestId) {
      return parseResponse(
        MeetingSigningCreationStatusSchema,
        await callRpc("record_meeting_signing_request_created", {
          p_meeting_id: meetingId,
          p_run_id: runId,
          p_external_request_ref: externalRequestId,
        }),
        "signing request creation result",
      );
    },

    async completeDelivery(meetingId, runId) {
      return parseResponse(
        MeetingSigningPersistenceStatusSchema,
        await callRpc("complete_meeting_signing_delivery", {
          p_meeting_id: meetingId,
          p_run_id: runId,
        }),
        "signing delivery completion result",
      );
    },

    async recordFailure(meetingId, runId, failure) {
      return parseResponse(
        MeetingSigningFailureStatusSchema,
        await callRpc("record_meeting_signing_failure", {
          p_meeting_id: meetingId,
          p_run_id: runId,
          p_error_code: failure.code,
          p_error_message: failure.message,
        }),
        "signing delivery failure result",
      );
    },

    async retryDelivery(command) {
      return parseResponse(
        MeetingSigningRetryResultSchema,
        await callRpc("retry_meeting_signing_delivery", {
          p_meeting_id: command.meetingId,
          p_expected_version: command.expectedVersion,
          p_actor_profile_id: command.actorProfileId,
        }),
        "signing delivery retry result",
      );
    },
  };
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MeetingSigningRepositoryError(`Supabase returned an invalid ${description}.`, {
      code: "invalid_supabase_response",
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function resolveConfiguration(
  apiUrl: string | undefined,
  secretKey: string | undefined,
  fetchImplementation: typeof fetch,
) {
  const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!resolvedApiUrl || !resolvedSecretKey) {
    throw new MeetingSigningRepositoryError("Supabase meeting signing persistence is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new MeetingSigningRepositoryError("A fetch implementation is required for Supabase meeting signing.", {
      code: "fetch_not_configured",
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

export const supabaseMeetingSigningRepository = createSupabaseMeetingSigningRepository();
