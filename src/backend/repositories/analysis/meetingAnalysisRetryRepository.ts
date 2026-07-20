import type {
  PrepareMeetingAnalysisRetryResult,
  RetryMeetingAnalysisCommand,
} from "../../../shared/contracts/meetingAnalysisRetry";

export interface MeetingAnalysisRetryRepository {
  prepareRetry(command: RetryMeetingAnalysisCommand): Promise<PrepareMeetingAnalysisRetryResult>;
}
