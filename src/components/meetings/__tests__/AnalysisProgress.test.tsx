import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnalysisProgress } from "../AnalysisProgress";

const processing = {
  status: "AI_PROCESSING" as const,
  analysisAttempt: 2,
  failureReason: null,
  humanOwned: false,
};

describe("AnalysisProgress", () => {
  it("shows the current attempt out of a maximum of three", () => {
    render(<AnalysisProgress meeting={processing} />);
    expect(screen.getByText(/attempt 2 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/No AI service is running/i)).toBeInTheDocument();
  });

  it("marks every extracted area as awaiting fixture data while processing", () => {
    render(<AnalysisProgress meeting={processing} />);
    for (const area of ["Minutes", "Attendance", "Motions", "Votes"]) {
      expect(screen.getByText(area)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Awaiting fixture result")).toHaveLength(4);
  });

  it("shows exhausted attempts and the failure reason after AI failure", () => {
    render(
      <AnalysisProgress
        meeting={{
          ...processing,
          status: "AI_FAILED",
          analysisAttempt: 3,
          failureReason: "Transcription service returned an empty result.",
        }}
      />,
    );
    expect(screen.getByText(/all 3 automatic attempts exhausted/i)).toBeInTheDocument();
    expect(screen.getByText(/Fixture failure detail: Transcription service returned an empty result/i)).toBeInTheDocument();
    expect(screen.getByText(/Retry Analysis changes local demo state; no AI service is called/i)).toBeInTheDocument();
  });

  it("shows the human-owned state instead of awaiting placeholders once editing began", () => {
    render(<AnalysisProgress meeting={{ ...processing, status: "AI_FAILED", analysisAttempt: 3, humanOwned: true }} />);
    expect(screen.getByText(/maintained manually by officers/i)).toBeInTheDocument();
    expect(screen.queryByText("Awaiting fixture result")).not.toBeInTheDocument();
  });
});
