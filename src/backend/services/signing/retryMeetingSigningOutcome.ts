import type { MeetingSigningOutcomeRepository } from "../../repositories/signing/meetingSigningOutcomeRepository";
import { supabaseMeetingSigningOutcomeRepository } from "../../repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import {
  RetryMeetingSigningCommandSchema,
  type RetryMeetingSigningCommand,
} from "../../../shared/contracts/meetingSigning";
import { reconcileMeetingSigning, type SigningOutcomeProcessResult } from "./processSigningOutcome";

export function createRetryMeetingSigningOutcomeService({
  repository = supabaseMeetingSigningOutcomeRepository,
  reconcile = reconcileMeetingSigning,
}: {
  repository?: MeetingSigningOutcomeRepository;
  reconcile?: (meetingId: string) => Promise<SigningOutcomeProcessResult>;
} = {}) {
  return async function retryMeetingSigningOutcome(command: RetryMeetingSigningCommand) {
    const validated = RetryMeetingSigningCommandSchema.parse(command);
    const result = await repository.retryOutcome(validated);
    if (result.status !== "retry_started") return result;
    return {
      ...result,
      reconciliation: await reconcile(result.meetingId),
    };
  };
}

export const retryMeetingSigningOutcome = createRetryMeetingSigningOutcomeService();
