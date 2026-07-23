import { after } from "next/server";
import {
  processMeetingAnalysis,
  type MeetingAnalysisProcessResult,
} from "../../services/ai/processMeetingAnalysis";

type MeetingAnalysisProcessor = (meetingId: string) => Promise<MeetingAnalysisProcessResult>;
type PostResponseScheduler = (task: () => Promise<void>) => void;

interface AnalysisSchedulerLogger {
  error(message: string, context: Record<string, unknown>): void;
}

export function createMeetingAnalysisScheduler({
  processor = processMeetingAnalysis,
  schedule = after,
  logger = console,
}: {
  processor?: MeetingAnalysisProcessor;
  schedule?: PostResponseScheduler;
  logger?: AnalysisSchedulerLogger;
} = {}) {
  return async function scheduleMeetingAnalysis(meetingId: string): Promise<void> {
    schedule(async () => {
      try {
        await processor(meetingId);
      } catch (error) {
        logger.error("Scheduled meeting analysis failed unexpectedly", {
          meetingId,
          reason: error instanceof Error ? error.message : "Unknown meeting analysis failure.",
        });
      }
    });
  };
}

export const scheduleMeetingAnalysis = createMeetingAnalysisScheduler();
