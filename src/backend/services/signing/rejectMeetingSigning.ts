import { FirmaSigningClientError, firmaSigningClient } from "../../integrations/signing/firmaSigningClient";
import type { SigningRequestProvider } from "../../integrations/signing/signingRequestProvider";
import type { MeetingSigningOutcomeRepository } from "../../repositories/signing/meetingSigningOutcomeRepository";
import { supabaseMeetingSigningOutcomeRepository } from "../../repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import {
  RejectMeetingSigningCommandSchema,
  type RejectMeetingSigningCommand,
} from "../../../shared/contracts/meetingSigning";

export function createRejectMeetingSigningService({
  repository = supabaseMeetingSigningOutcomeRepository,
  provider = firmaSigningClient,
}: {
  repository?: MeetingSigningOutcomeRepository;
  provider?: SigningRequestProvider;
} = {}) {
  return async function rejectMeetingSigning(command: RejectMeetingSigningCommand) {
    const validated = RejectMeetingSigningCommandSchema.parse(command);
    const claim = await repository.claimRejection(validated);
    if (claim.status !== "claimed") return claim;

    try {
      await provider.cancelRequest(claim.externalRequestId, validated.comment);
      return await repository.completeRejection(claim.requestId, claim.runId);
    } catch (error) {
      const failure = error instanceof FirmaSigningClientError
        ? { code: error.code, message: safeMessage(error.message) }
        : {
          code: "esign_rejection_failed",
          message: error instanceof Error ? safeMessage(error.message) : "Signing rejection failed.",
        };
      const status = await repository.recordRejectionFailure(claim.requestId, claim.runId, failure);
      return {
        status: status === "failed" ? "failed" as const : status,
        meetingId: claim.meetingId,
        version: claim.version,
        error: failure,
      };
    }
  };
}

function safeMessage(message: string) {
  const cleaned = message.trim();
  return cleaned ? cleaned.slice(0, 2_000) : "Signing rejection failed.";
}

export const rejectMeetingSigning = createRejectMeetingSigningService();
