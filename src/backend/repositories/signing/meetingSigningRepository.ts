import type {
  MeetingSigningClaim,
  MeetingSigningCreationStatus,
  MeetingSigningFailure,
  MeetingSigningFailureStatus,
  MeetingSigningPersistenceStatus,
  MeetingSigningRetryResult,
  RetryMeetingSigningCommand,
} from "../../../shared/contracts/meetingSigning";

export interface MeetingSigningRepository {
  claimDelivery(meetingId: string): Promise<MeetingSigningClaim>;
  recordRequestCreated(
    meetingId: string,
    runId: string,
    externalRequestId: string,
  ): Promise<MeetingSigningCreationStatus>;
  completeDelivery(meetingId: string, runId: string): Promise<MeetingSigningPersistenceStatus>;
  recordFailure(
    meetingId: string,
    runId: string,
    failure: MeetingSigningFailure,
  ): Promise<MeetingSigningFailureStatus>;
  retryDelivery(command: RetryMeetingSigningCommand): Promise<MeetingSigningRetryResult>;
}
