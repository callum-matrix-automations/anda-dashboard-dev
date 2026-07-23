import type {
  FirmaWebhookEvent,
  FirmaWebhookReceipt,
  MeetingSigningFailure,
  MeetingSigningOutcomeClaim,
  MeetingSigningRejectionClaim,
  MeetingSigningRejectionResult,
  MeetingSigningSessionRecord,
  RejectMeetingSigningCommand,
  RetryMeetingSigningCommand,
  RetryMeetingSigningOutcomeResult,
} from "../../../shared/contracts/meetingSigning";

export interface CompletedSigningOutcome {
  providerStatus: string;
  recipientRef: string;
  recipientEmail: string;
  providerCompletedAt: string;
  signedDocumentSha256: string;
  signedDocumentSizeBytes: number;
}

export interface SigningNoChange {
  providerStatus: string;
  recipientRef: string | null;
  recipientEmail: string | null;
}

export interface SigningOutcomeFailure extends MeetingSigningFailure {
  providerStatus: string | null;
  retryable: boolean;
}

export interface MeetingSigningOutcomeRepository {
  receiveWebhook(
    event: FirmaWebhookEvent,
    externalRequestId: string | null,
    payloadSha256: string,
  ): Promise<FirmaWebhookReceipt>;
  claimWebhook(eventId: string): Promise<MeetingSigningOutcomeClaim>;
  claimReconciliation(meetingId: string): Promise<MeetingSigningOutcomeClaim>;
  completeOutcome(
    claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
    outcome: CompletedSigningOutcome,
  ): Promise<"saved" | "not_found" | "stale">;
  completeNoChange(
    claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
    outcome: SigningNoChange,
  ): Promise<"saved" | "not_found" | "stale">;
  recordOutcomeFailure(
    claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
    failure: SigningOutcomeFailure,
  ): Promise<"failed" | "not_found" | "stale">;
  getSession(meetingId: string): Promise<MeetingSigningSessionRecord>;
  claimRejection(command: RejectMeetingSigningCommand): Promise<MeetingSigningRejectionClaim>;
  completeRejection(
    requestId: string,
    runId: string,
  ): Promise<MeetingSigningRejectionResult>;
  recordRejectionFailure(
    requestId: string,
    runId: string,
    failure: MeetingSigningFailure,
  ): Promise<"failed" | "not_found" | "stale">;
  retryOutcome(command: RetryMeetingSigningCommand): Promise<RetryMeetingSigningOutcomeResult>;
}
