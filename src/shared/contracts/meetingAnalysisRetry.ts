import { z } from "zod";

export const RetryMeetingAnalysisCommandSchema = z.object({
  meetingId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  actorProfileId: z.string().uuid(),
}).strict();

export const PrepareMeetingAnalysisRetryResultSchema = z.object({
  status: z.enum([
    "retry_started",
    "not_found",
    "forbidden",
    "conflict",
    "protected",
    "invalid_state",
  ]),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
}).strict();

export const MeetingAnalysisRetryResultSchema = z.object({
  status: z.enum([
    "completed",
    "not_found",
    "forbidden",
    "conflict",
    "protected",
    "invalid_state",
    "failed",
  ]),
  meetingId: z.string().uuid(),
  version: z.number().int().positive().nullable(),
  attempt: z.number().int().positive().nullable(),
}).strict();

export type RetryMeetingAnalysisCommand = z.infer<typeof RetryMeetingAnalysisCommandSchema>;
export type PrepareMeetingAnalysisRetryResult = z.infer<typeof PrepareMeetingAnalysisRetryResultSchema>;
export type MeetingAnalysisRetryResult = z.infer<typeof MeetingAnalysisRetryResultSchema>;
