import { describe, expect, it } from "vitest";
import { MAX_ANALYSIS_ATTEMPTS, analysisAttemptsExhausted, clampAnalysisAttempt } from "../analysis";

describe("AI analysis attempts", () => {
  it("caps at exactly three attempts", () => {
    expect(MAX_ANALYSIS_ATTEMPTS).toBe(3);
  });

  it("clamps attempts into the 1..3 bound", () => {
    expect(clampAnalysisAttempt(0)).toBe(1);
    expect(clampAnalysisAttempt(1)).toBe(1);
    expect(clampAnalysisAttempt(3)).toBe(3);
    expect(clampAnalysisAttempt(7)).toBe(3);
  });

  it("is exhausted only when AI failed at the maximum attempt", () => {
    expect(analysisAttemptsExhausted({ status: "AI_FAILED", analysisAttempt: 3 })).toBe(true);
    expect(analysisAttemptsExhausted({ status: "AI_FAILED", analysisAttempt: 2 })).toBe(false);
    expect(analysisAttemptsExhausted({ status: "AI_PROCESSING", analysisAttempt: 3 })).toBe(false);
    expect(analysisAttemptsExhausted({ status: "PENDING_APPROVAL", analysisAttempt: 3 })).toBe(false);
  });
});
