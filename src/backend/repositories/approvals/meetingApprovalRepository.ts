import type {
  ApproveMeetingCommand,
  MeetingApprovalResult,
  MeetingPdfClaim,
  MeetingPdfFailure,
  MeetingPdfFailureStatus,
  MeetingPdfPersistenceStatus,
  MeetingPdfRetryResult,
  RetryMeetingPdfCommand,
} from "../../../shared/contracts/meetingApproval";

export interface PersistedMinutesPdf {
  path: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
}

export interface MeetingApprovalRepository {
  approve(command: ApproveMeetingCommand): Promise<MeetingApprovalResult>;
  retryPdf(command: RetryMeetingPdfCommand): Promise<MeetingPdfRetryResult>;
  claimPdfGeneration(meetingId: string): Promise<MeetingPdfClaim>;
  completePdfGeneration(
    meetingId: string,
    runId: string,
    artifact: PersistedMinutesPdf,
  ): Promise<MeetingPdfPersistenceStatus>;
  recordPdfFailure(
    meetingId: string,
    runId: string,
    failure: MeetingPdfFailure,
  ): Promise<MeetingPdfFailureStatus>;
}
