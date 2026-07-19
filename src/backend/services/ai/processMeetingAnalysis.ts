import { analyzeMeetingTranscript } from "./analyzeMeetingTranscript";
import type { MeetingDraft } from "../../../shared/contracts/meetingAnalysis";
import type {
  AnalysisFailure,
  MeetingAnalysisRepository,
} from "../../repositories/analysis/meetingAnalysisRepository";
import { supabaseMeetingAnalysisRepository } from "../../repositories/supabase/supabaseMeetingAnalysisRepository";

export const MAX_ANALYSIS_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAYS_MS = [250, 1_000] as const;

export type MeetingAnalysisProcessResult =
  | { status: "completed"; meetingId: string; attempt: number }
  | { status: "failed"; meetingId: string; attempts: number; error: AnalysisFailure }
  | {
    status: "not_found" | "protected" | "retry_required" | "already_completed" | "already_processing" | "stale";
    meetingId: string;
    attempt: number | null;
  };

interface MeetingAnalysisProcessorOptions {
  repository: MeetingAnalysisRepository;
  analyze?: typeof analyzeMeetingTranscript;
  delay?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

export function createMeetingAnalysisProcessor({
  repository,
  analyze = analyzeMeetingTranscript,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: MeetingAnalysisProcessorOptions) {
  return async function processMeetingAnalysis(
    meetingId: string,
    { manualRetry = false }: { manualRetry?: boolean } = {},
  ): Promise<MeetingAnalysisProcessResult> {
    let allowManualRetry = manualRetry;

    while (true) {
      const claim = await repository.claimAnalysis(meetingId, { manualRetry: allowManualRetry });
      allowManualRetry = false;
      if (claim.status !== "claimed") {
        return {
          status: claim.status,
          meetingId,
          attempt: claim.attempt,
        };
      }

      try {
        const draft: MeetingDraft = await analyze(claim.input);
        const persistenceStatus = await repository.persistDraft(meetingId, claim.runId, draft);
        if (persistenceStatus === "saved") {
          return { status: "completed", meetingId, attempt: claim.attempt };
        }
        return {
          status: persistenceStatus === "not_found" ? "not_found" : persistenceStatus,
          meetingId,
          attempt: claim.attempt,
        };
      } catch (error) {
        const failure = describeAnalysisFailure(error);
        const failureStatus = await repository.recordFailure(meetingId, claim.runId, failure);
        if (failureStatus === "retry_scheduled") {
          await delay(retryDelaysMs[claim.attempt - 1] ?? 0);
          continue;
        }
        if (failureStatus === "failed") {
          return {
            status: "failed",
            meetingId,
            attempts: claim.attempt,
            error: failure,
          };
        }
        return {
          status: failureStatus === "not_found" ? "not_found" : failureStatus,
          meetingId,
          attempt: claim.attempt,
        };
      }
    }
  };
}

export function describeAnalysisFailure(error: unknown): AnalysisFailure {
  if (error instanceof Error) {
    const codedError = error as Error & { code?: unknown };
    const code = typeof codedError.code === "string" && codedError.code.trim()
      ? codedError.code.trim().slice(0, 200)
      : "analysis_failed";
    return {
      code,
      message: error.message.trim().slice(0, 1_000) || "Meeting analysis failed.",
    };
  }
  return {
    code: "analysis_failed",
    message: "Meeting analysis failed.",
  };
}

export const processMeetingAnalysis = createMeetingAnalysisProcessor({
  repository: supabaseMeetingAnalysisRepository,
});
