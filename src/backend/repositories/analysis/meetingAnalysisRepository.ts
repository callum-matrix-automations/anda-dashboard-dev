import type {
  MeetingAnalysisInput,
  MeetingDraft,
} from "../../../shared/contracts/meetingAnalysis";

export const ANALYSIS_CLAIM_STATUSES = [
  "claimed",
  "not_found",
  "protected",
  "retry_required",
  "already_completed",
  "already_processing",
] as const;

export type AnalysisClaimStatus = (typeof ANALYSIS_CLAIM_STATUSES)[number];

export type MeetingAnalysisClaim =
  | {
    status: "claimed";
    meetingId: string;
    runId: string;
    attempt: number;
    input: MeetingAnalysisInput;
  }
  | {
    status: Exclude<AnalysisClaimStatus, "claimed">;
    meetingId: string;
    attempt: number | null;
    runId?: string;
  };

export type DraftPersistenceStatus = "saved" | "not_found" | "protected" | "stale";
export type AnalysisFailureStatus = "retry_scheduled" | "failed" | "not_found" | "protected" | "stale";
export type HumanOwnershipStatus = "marked" | "not_found";

export interface AnalysisFailure {
  code: string;
  message: string;
}

export interface MeetingAnalysisRepository {
  claimAnalysis(meetingId: string, options?: { manualRetry?: boolean }): Promise<MeetingAnalysisClaim>;
  persistDraft(meetingId: string, runId: string, draft: MeetingDraft): Promise<DraftPersistenceStatus>;
  recordFailure(meetingId: string, runId: string, failure: AnalysisFailure): Promise<AnalysisFailureStatus>;
  markHumanOwned(meetingId: string): Promise<HumanOwnershipStatus>;
}
