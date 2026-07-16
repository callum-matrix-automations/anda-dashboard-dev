import type { Meeting } from "./types";

// AIDEV-NOTE: The diagrams allow at most three automatic analysis attempts before a
// human must take over (retry or complete manually). Pure helpers — no timers.
export const MAX_ANALYSIS_ATTEMPTS = 3;

export function clampAnalysisAttempt(attempt: number): number {
  return Math.min(Math.max(attempt, 1), MAX_ANALYSIS_ATTEMPTS);
}

export function analysisAttemptsExhausted(
  meeting: Pick<Meeting, "status" | "analysisAttempt">,
): boolean {
  return meeting.status === "AI_FAILED" && meeting.analysisAttempt >= MAX_ANALYSIS_ATTEMPTS;
}
