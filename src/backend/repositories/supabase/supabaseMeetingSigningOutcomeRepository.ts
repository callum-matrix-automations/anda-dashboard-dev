import { z } from "zod";
import type { MeetingSigningOutcomeRepository } from "../signing/meetingSigningOutcomeRepository";
import {
  FirmaWebhookReceiptSchema,
  MeetingSigningFailureStatusSchema,
  MeetingSigningOutcomeClaimSchema,
  MeetingSigningPersistenceStatusSchema,
  MeetingSigningRejectionClaimSchema,
  MeetingSigningRejectionResultSchema,
  MeetingSigningSessionRecordSchema,
  RetryMeetingSigningOutcomeResultSchema,
} from "../../../shared/contracts/meetingSigning";
import { supabaseServerHeaders } from "./supabaseServerHeaders";
import { MeetingSigningRepositoryError } from "./supabaseMeetingSigningRepository";

interface Options {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

export function createSupabaseMeetingSigningOutcomeRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: Options = {}): MeetingSigningOutcomeRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey) {
      throw new MeetingSigningRepositoryError("Supabase signing outcome persistence is not configured.", {
        code: "supabase_not_configured",
      });
    }

    let response: Response;
    try {
      response = await fetchImplementation(new URL(`/rest/v1/rpc/${name}`, resolvedApiUrl), {
        method: "POST",
        headers: supabaseServerHeaders(resolvedSecretKey, {
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new MeetingSigningRepositoryError("Supabase signing outcome request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingSigningRepositoryError(
        details.success ? details.data.message : `Supabase returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  return {
    async receiveWebhook(event, externalRequestId, payloadSha256) {
      return parse(FirmaWebhookReceiptSchema, await callRpc("receive_firma_webhook_event", {
        p_provider_event_id: event.id,
        p_event_type: event.type,
        p_external_request_ref: externalRequestId,
        p_payload_sha256: payloadSha256,
        p_payload: event,
      }), "webhook receipt");
    },
    async claimWebhook(eventId) {
      return parse(MeetingSigningOutcomeClaimSchema, await callRpc("claim_firma_webhook_event", {
        p_provider_event_id: eventId,
      }), "webhook claim");
    },
    async claimReconciliation(meetingId) {
      return parse(MeetingSigningOutcomeClaimSchema, await callRpc("claim_meeting_signing_reconciliation", {
        p_meeting_id: meetingId,
      }), "reconciliation claim");
    },
    async completeOutcome(claim, outcome) {
      return parse(MeetingSigningPersistenceStatusSchema, await callRpc("complete_meeting_signing_outcome", {
        p_request_id: claim.requestId,
        p_run_id: claim.runId,
        p_event_record_id: claim.eventRecordId,
        p_provider_status: outcome.providerStatus,
        p_recipient_ref: outcome.recipientRef,
        p_recipient_email: outcome.recipientEmail,
        p_provider_completed_at: outcome.providerCompletedAt,
        p_signed_document_sha256: outcome.signedDocumentSha256,
        p_signed_document_size_bytes: outcome.signedDocumentSizeBytes,
      }), "outcome completion");
    },
    async completeNoChange(claim, outcome) {
      return parse(MeetingSigningPersistenceStatusSchema, await callRpc("complete_meeting_signing_no_change", {
        p_request_id: claim.requestId,
        p_run_id: claim.runId,
        p_event_record_id: claim.eventRecordId,
        p_provider_status: outcome.providerStatus,
        p_recipient_ref: outcome.recipientRef,
        p_recipient_email: outcome.recipientEmail,
      }), "no-change completion");
    },
    async recordOutcomeFailure(claim, failure) {
      return parse(MeetingSigningFailureStatusSchema, await callRpc("record_meeting_signing_outcome_failure", {
        p_request_id: claim.requestId,
        p_run_id: claim.runId,
        p_event_record_id: claim.eventRecordId,
        p_provider_status: failure.providerStatus,
        p_error_code: failure.code,
        p_error_message: failure.message,
        p_retryable: failure.retryable,
      }), "outcome failure");
    },
    async getSession(meetingId) {
      return parse(MeetingSigningSessionRecordSchema, await callRpc("get_meeting_signing_session", {
        p_meeting_id: meetingId,
      }), "signing session");
    },
    async claimRejection(command) {
      return parse(MeetingSigningRejectionClaimSchema, await callRpc("claim_meeting_signing_rejection", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
        p_comment: command.comment,
      }), "rejection claim");
    },
    async completeRejection(requestId, runId) {
      return parse(MeetingSigningRejectionResultSchema, await callRpc("complete_meeting_signing_rejection", {
        p_request_id: requestId,
        p_run_id: runId,
      }), "rejection completion");
    },
    async recordRejectionFailure(requestId, runId, failure) {
      return parse(MeetingSigningFailureStatusSchema, await callRpc("record_meeting_signing_rejection_failure", {
        p_request_id: requestId,
        p_run_id: runId,
        p_error_code: failure.code,
        p_error_message: failure.message,
      }), "rejection failure");
    },
    async retryOutcome(command) {
      return parse(RetryMeetingSigningOutcomeResultSchema, await callRpc("retry_meeting_signing_outcome", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
      }), "outcome retry");
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown, description: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new MeetingSigningRepositoryError(`Supabase returned an invalid ${description}.`, {
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

export const supabaseMeetingSigningOutcomeRepository =
  createSupabaseMeetingSigningOutcomeRepository();
