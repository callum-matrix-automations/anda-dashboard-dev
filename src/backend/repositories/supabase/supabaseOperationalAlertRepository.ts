import { z } from "zod";
import type { OperationalAlertRepository } from "../operations/operationalAlertRepository";
import {
  OperationalAlertDeliveryClaimSchema,
  OperationalAlertFailureStatusSchema,
  OperationalAlertPersistenceStatusSchema,
  OperationalAlertRecordResultSchema,
  OperationalIssueReportResultSchema,
} from "../../../shared/contracts/operationalAlerts";
import { MeetingSigningOutcomeClaimSchema } from "../../../shared/contracts/meetingSigning";

interface Options {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({ code: z.string().optional(), message: z.string() });

export class OperationalAlertRepositoryError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, { code = "operational_alert_repository_failed", status, cause }: {
    code?: string;
    status?: number;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "OperationalAlertRepositoryError";
    this.code = code;
    this.status = status;
  }
}

export function createSupabaseOperationalAlertRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: Options = {}): OperationalAlertRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey || typeof fetchImplementation !== "function") {
      throw new OperationalAlertRepositoryError("Supabase operational alert persistence is not configured.", {
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
      throw new OperationalAlertRepositoryError("Supabase operational alert request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new OperationalAlertRepositoryError(
        details.success ? details.data.message : `Supabase returned HTTP ${response.status}.`,
        {
          code: details.success ? details.data.code : "supabase_response_failed",
          status: response.status,
        },
      );
    }
    return responseBody;
  }

  return {
    async record(input) {
      return parse(OperationalAlertRecordResultSchema, await callRpc("record_operational_alert", {
        p_stage: input.stage,
        p_failure_code: input.failureCode,
        p_meeting_id: input.meetingId ?? null,
        p_entity_ref: input.entityRef ?? null,
        p_workflow_status: input.workflowStatus ?? null,
        p_deduplication_key: input.deduplicationKey ?? null,
      }), "operational alert result");
    },
    async resolve(input) {
      return parse(z.number().int().nonnegative(), await callRpc("resolve_operational_alerts", {
        p_stage: input.stage,
        p_meeting_id: input.meetingId ?? null,
        p_entity_ref: input.entityRef ?? null,
        p_resolved_at: input.resolvedAt ?? new Date().toISOString(),
      }), "operational alert resolution count");
    },
    async claimDeliveries(limit, maxAttempts) {
      return parse(OperationalAlertDeliveryClaimSchema.array(), await callRpc(
        "claim_operational_alert_deliveries",
        { p_limit: limit, p_max_attempts: maxAttempts },
      ), "operational alert delivery claims");
    },
    async completeDelivery(alertId, runId) {
      return parse(OperationalAlertPersistenceStatusSchema, await callRpc(
        "complete_operational_alert_delivery",
        { p_alert_id: alertId, p_run_id: runId },
      ), "operational alert delivery completion");
    },
    async recordDeliveryFailure(alertId, runId, errorCode, retryDelaySeconds, maxAttempts) {
      return parse(OperationalAlertFailureStatusSchema, await callRpc(
        "record_operational_alert_delivery_failure",
        {
          p_alert_id: alertId,
          p_run_id: runId,
          p_error_code: errorCode,
          p_retry_delay_seconds: retryDelaySeconds,
          p_max_attempts: maxAttempts,
        },
      ), "operational alert delivery failure");
    },
    async createIssueReport(command) {
      return parse(OperationalIssueReportResultSchema, await callRpc("create_operational_issue_report", {
        p_meeting_id: command.meetingId,
        p_reporter_profile_id: command.reporterProfileId,
        p_comment: command.comment ?? null,
      }), "operational issue report");
    },
    async claimStaleSigningCandidates(ageMinutes, limit, maxAttempts) {
      const claims = parse(MeetingSigningOutcomeClaimSchema.array(), await callRpc(
        "claim_stale_signing_reconciliations",
        { p_age_minutes: ageMinutes, p_limit: limit, p_max_attempts: maxAttempts },
      ), "stale signing claims");
      return claims.flatMap((claim) => claim.status === "claimed" ? [claim] : []);
    },
    async listStaleSigningCandidates(ageMinutes, limit, maxAttempts) {
      return parse(z.string().uuid().array(), await callRpc(
        "list_stale_signing_reconciliation_candidates",
        { p_age_minutes: ageMinutes, p_limit: limit, p_max_attempts: maxAttempts },
      ), "stale signing candidate list");
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OperationalAlertRepositoryError(`Supabase returned an invalid ${description}.`, {
      code: "invalid_supabase_response",
      cause: parsed.error,
    });
  }
  return parsed.data;
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

export const supabaseOperationalAlertRepository = createSupabaseOperationalAlertRepository();
