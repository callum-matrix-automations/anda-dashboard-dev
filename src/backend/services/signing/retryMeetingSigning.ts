import type { MeetingSigningRepository } from "../../repositories/signing/meetingSigningRepository";
import { supabaseMeetingSigningRepository } from "../../repositories/supabase/supabaseMeetingSigningRepository";
import {
  RetryMeetingSigningCommandSchema,
  type RetryMeetingSigningCommand,
} from "../../../shared/contracts/meetingSigning";
import {
  processMeetingSigning,
  type MeetingSigningProcessResult,
} from "./processMeetingSigning";

type SigningProcessor = (meetingId: string) => Promise<MeetingSigningProcessResult>;

export function createMeetingSigningService({
  repository = supabaseMeetingSigningRepository,
  processSigning = processMeetingSigning,
}: {
  repository?: MeetingSigningRepository;
  processSigning?: SigningProcessor;
} = {}) {
  return {
    async retryMeetingSigning(command: RetryMeetingSigningCommand) {
      const validated = RetryMeetingSigningCommandSchema.parse(command);
      const result = await repository.retryDelivery(validated);
      if (result.status === "retry_started") await processSigning(result.meetingId);
      return result;
    },
  };
}

export const meetingSigningService = createMeetingSigningService();
export const retryMeetingSigning = meetingSigningService.retryMeetingSigning;
