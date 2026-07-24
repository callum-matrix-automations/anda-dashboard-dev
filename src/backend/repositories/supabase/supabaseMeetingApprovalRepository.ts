import { z } from "zod";
import type { MeetingApprovalRepository } from "../approvals/meetingApprovalRepository";
import {
  MeetingApprovalResultSchema,
  MeetingPdfClaimSchema,
  MeetingPdfFailureStatusSchema,
  MeetingPdfPersistenceStatusSchema,
  MeetingPdfRetryResultSchema,
} from "../../../shared/contracts/meetingApproval";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

interface SupabaseMeetingApprovalRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

export class MeetingApprovalRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = "MeetingApprovalRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMeetingApprovalRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseMeetingApprovalRepositoryOptions = {}): MeetingApprovalRepository {
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
      throw new MeetingApprovalRepositoryError("Supabase meeting approval request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingApprovalRepositoryError(
        details.success ? details.data.message : `Supabase meeting approval returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async approve(command) {
      return parseResponse(
        MeetingApprovalResultSchema,
        await callRpc("approve_meeting_for_pdf", {
          p_meeting_id: command.meetingId,
          p_expected_version: command.expectedVersion,
          p_actor_profile_id: command.actorProfileId,
          p_acknowledge_unresolved_votes: command.acknowledgeUnresolvedVotes,
        }),
        "approval result",
      );
    },

    async retryPdf(command) {
      return parseResponse(
        MeetingPdfRetryResultSchema,
        await callRpc("retry_meeting_pdf_generation", {
          p_meeting_id: command.meetingId,
          p_expected_version: command.expectedVersion,
          p_actor_profile_id: command.actorProfileId,
        }),
        "PDF retry result",
      );
    },

    async claimPdfGeneration(meetingId) {
      return parseResponse(
        MeetingPdfClaimSchema,
        await callRpc("claim_meeting_pdf_generation", { p_meeting_id: meetingId }),
        "PDF generation claim",
      );
    },

    async completePdfGeneration(meetingId, runId, artifact) {
      return parseResponse(
        MeetingPdfPersistenceStatusSchema,
        await callRpc("complete_meeting_pdf_generation", {
          p_meeting_id: meetingId,
          p_run_id: runId,
          p_path: artifact.path,
          p_sha256: artifact.sha256,
          p_size_bytes: artifact.sizeBytes,
          p_page_count: artifact.pageCount,
        }),
        "PDF completion result",
      );
    },

    async recordPdfFailure(meetingId, runId, failure) {
      return parseResponse(
        MeetingPdfFailureStatusSchema,
        await callRpc("record_meeting_pdf_failure", {
          p_meeting_id: meetingId,
          p_run_id: runId,
          p_error_code: failure.code,
          p_error_message: failure.message,
        }),
        "PDF failure result",
      );
    },
  };
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MeetingApprovalRepositoryError(`Supabase returned an invalid ${description}.`, {
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
    throw new MeetingApprovalRepositoryError("Supabase meeting approval persistence is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new MeetingApprovalRepositoryError("A fetch implementation is required for Supabase meeting approval.", {
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

export const supabaseMeetingApprovalRepository = createSupabaseMeetingApprovalRepository();
