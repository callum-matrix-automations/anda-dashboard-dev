import type { MeetingAnalysisRetryRepository } from "../../repositories/analysis/meetingAnalysisRetryRepository";
import { supabaseMeetingAnalysisRetryRepository } from "../../repositories/supabase/supabaseMeetingAnalysisRetryRepository";
import {
  MeetingAnalysisRetryResultSchema,
  RetryMeetingAnalysisCommandSchema,
  type MeetingAnalysisRetryResult,
  type RetryMeetingAnalysisCommand,
} from "../../../shared/contracts/meetingAnalysisRetry";
import {
  processMeetingAnalysis,
  type MeetingAnalysisProcessResult,
} from "./processMeetingAnalysis";

type AnalysisProcessor = (
  meetingId: string,
  options?: { manualRetry?: boolean },
) => Promise<MeetingAnalysisProcessResult>;

export function createMeetingAnalysisRetryService({
  repository = supabaseMeetingAnalysisRetryRepository,
  processAnalysis = processMeetingAnalysis,
}: {
  repository?: MeetingAnalysisRetryRepository;
  processAnalysis?: AnalysisProcessor;
} = {}) {
  return async function retryMeetingAnalysis(
    command: RetryMeetingAnalysisCommand,
  ): Promise<MeetingAnalysisRetryResult> {
    const validated = RetryMeetingAnalysisCommandSchema.parse(command);
    const prepared = await repository.prepareRetry(validated);
    if (prepared.status !== "retry_started") {
      return MeetingAnalysisRetryResultSchema.parse({
        ...prepared,
        attempt: null,
      });
    }

    const processed = await processAnalysis(validated.meetingId);
    if (processed.status === "completed") {
      return MeetingAnalysisRetryResultSchema.parse({
        status: "completed",
        meetingId: processed.meetingId,
        version: null,
        attempt: processed.attempt,
      });
    }
    if (processed.status === "failed") {
      return MeetingAnalysisRetryResultSchema.parse({
        status: "failed",
        meetingId: processed.meetingId,
        version: null,
        attempt: processed.attempts,
      });
    }

    return MeetingAnalysisRetryResultSchema.parse({
      status: processed.status === "not_found" || processed.status === "protected"
        ? processed.status
        : "invalid_state",
      meetingId: processed.meetingId,
      version: null,
      attempt: positiveAttempt(processed.attempt),
    });
  };
}

function positiveAttempt(attempt: number | null) {
  return attempt !== null && attempt > 0 ? attempt : null;
}

export const retryMeetingAnalysis = createMeetingAnalysisRetryService();
