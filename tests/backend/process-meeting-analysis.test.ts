import { describe, expect, it, vi } from "vitest";
import type { MeetingAnalysisRepository } from "../../src/backend/repositories/analysis/meetingAnalysisRepository";
import {
  createMeetingAnalysisProcessor,
  describeAnalysisFailure,
} from "../../src/backend/services/ai/processMeetingAnalysis";
import { MeetingAnalysisError } from "../../src/backend/services/ai/analyzeMeetingTranscript";
import { OpenAiApiError } from "../../src/backend/integrations/ai/openAiResponsesClient";
import type { MeetingDraft } from "../../src/shared/contracts/meetingAnalysis";

const meetingId = "11111111-1111-4111-8111-111111111111";
const input = {
  meeting: {
    sourceMeetingId: "meeting_source_001",
    title: "Board meeting",
    meetingDate: "2026-07-19",
    durationMinutes: 60,
  },
  transcript: { language: "en-GB", content: "Eleanor Hughes: The motion carried." },
  participants: [{
    participantRef: "10000000-0000-4000-8000-000000000001",
    displayName: "Eleanor Hughes",
  }],
};

const draft: MeetingDraft = {
  schemaVersion: "1.0",
  minutes: {
    summary: "The motion carried.",
    sections: [{ heading: "Decision", content: "The board carried the motion." }],
  },
  attendees: [{
    participantRef: "10000000-0000-4000-8000-000000000001",
    displayName: "Eleanor Hughes",
  }],
  motions: [],
};

describe("processMeetingAnalysis", () => {
  it("persists a successful validated draft", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis.mockResolvedValue(claim(1));
    repository.persistDraft.mockResolvedValue("saved");
    const analyze = vi.fn().mockResolvedValue(draft);
    const alerts = alertServiceMock();
    const process = createMeetingAnalysisProcessor({ repository, analyze, alerts });

    await expect(process(meetingId)).resolves.toEqual({
      status: "completed",
      meetingId,
      attempt: 1,
    });
    expect(analyze).toHaveBeenCalledWith(input);
    expect(repository.persistDraft).toHaveBeenCalledWith(meetingId, runId(1), draft);
    expect(repository.recordFailure).not.toHaveBeenCalled();
    expect(alerts.resolveFailure).toHaveBeenCalledWith({ stage: "AI_ANALYSIS", meetingId });
  });

  it("retries a provider failure and succeeds on the next attempt", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis
      .mockResolvedValueOnce(claim(1))
      .mockResolvedValueOnce(claim(2));
    repository.recordFailure.mockResolvedValue("retry_scheduled");
    repository.persistDraft.mockResolvedValue("saved");
    const providerFailure = new OpenAiApiError("OpenAI is temporarily unavailable.", {
      status: 503,
      code: "service_unavailable",
    });
    const analyze = vi.fn()
      .mockRejectedValueOnce(providerFailure)
      .mockResolvedValueOnce(draft);
    const delay = vi.fn().mockResolvedValue(undefined);
    const process = createMeetingAnalysisProcessor({ repository, analyze, delay });

    await expect(process(meetingId)).resolves.toMatchObject({ status: "completed", attempt: 2 });
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(repository.recordFailure).toHaveBeenCalledWith(meetingId, runId(1), {
      code: "service_unavailable",
      message: "OpenAI is temporarily unavailable.",
    });
    expect(delay).toHaveBeenCalledOnce();
  });

  it("records malformed AI output and moves the third failed attempt to AI_FAILED", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis
      .mockResolvedValueOnce(claim(1))
      .mockResolvedValueOnce(claim(2))
      .mockResolvedValueOnce(claim(3));
    repository.recordFailure
      .mockResolvedValueOnce("retry_scheduled")
      .mockResolvedValueOnce("retry_scheduled")
      .mockResolvedValueOnce("failed");
    const malformedOutput = new MeetingAnalysisError(
      "OpenAI returned meeting analysis that did not match the required contract.",
      "invalid_analysis_output",
    );
    const analyze = vi.fn().mockRejectedValue(malformedOutput);
    const delay = vi.fn().mockResolvedValue(undefined);
    const alerts = alertServiceMock();
    const process = createMeetingAnalysisProcessor({ repository, analyze, delay, alerts });

    await expect(process(meetingId)).resolves.toEqual({
      status: "failed",
      meetingId,
      attempts: 3,
      error: {
        code: "invalid_analysis_output",
        message: "OpenAI returned meeting analysis that did not match the required contract.",
      },
    });
    expect(analyze).toHaveBeenCalledTimes(3);
    expect(repository.recordFailure).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(alerts.recordFailure).toHaveBeenCalledWith({
      stage: "AI_ANALYSIS",
      meetingId,
      failureCode: "invalid_analysis_output",
      workflowStatus: "AI_FAILED",
    });
  });

  it("records a timeout as a useful provider failure", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis.mockResolvedValue(claim(3));
    repository.recordFailure.mockResolvedValue("failed");
    const analyze = vi.fn().mockRejectedValue(new OpenAiApiError("OpenAI request timed out.", {
      code: "openai_timeout",
    }));
    const process = createMeetingAnalysisProcessor({ repository, analyze });

    await expect(process(meetingId)).resolves.toMatchObject({
      status: "failed",
      attempts: 3,
      error: { code: "openai_timeout", message: "OpenAI request timed out." },
    });
  });

  it.each([
    "not_found",
    "protected",
    "retry_required",
    "already_completed",
    "already_processing",
  ] as const)("does not call AI when the claim is %s", async (status) => {
    const repository = repositoryMock();
    repository.claimAnalysis.mockResolvedValue({ status, meetingId, attempt: 1 });
    const analyze = vi.fn();
    const process = createMeetingAnalysisProcessor({ repository, analyze });

    await expect(process(meetingId)).resolves.toMatchObject({ status });
    expect(analyze).not.toHaveBeenCalled();
    expect(repository.persistDraft).not.toHaveBeenCalled();
  });

  it("does not overwrite data when a completed response has become stale", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis.mockResolvedValue(claim(1));
    repository.persistDraft.mockResolvedValue("stale");
    const process = createMeetingAnalysisProcessor({
      repository,
      analyze: vi.fn().mockResolvedValue(draft),
    });

    await expect(process(meetingId)).resolves.toEqual({ status: "stale", meetingId, attempt: 1 });
    expect(repository.recordFailure).not.toHaveBeenCalled();
  });

  it("requests a manual reset only on the first recovery claim", async () => {
    const repository = repositoryMock();
    repository.claimAnalysis
      .mockResolvedValueOnce(claim(1))
      .mockResolvedValueOnce(claim(2));
    repository.recordFailure.mockResolvedValue("retry_scheduled");
    repository.persistDraft.mockResolvedValue("saved");
    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error("first recovery attempt failed"))
      .mockResolvedValueOnce(draft);
    const process = createMeetingAnalysisProcessor({ repository, analyze, delay: async () => undefined });

    await process(meetingId, { manualRetry: true });

    expect(repository.claimAnalysis).toHaveBeenNthCalledWith(1, meetingId, { manualRetry: true });
    expect(repository.claimAnalysis).toHaveBeenNthCalledWith(2, meetingId, { manualRetry: false });
  });
});

function alertServiceMock() {
  return {
    recordFailure: vi.fn().mockResolvedValue(undefined),
    resolveFailure: vi.fn().mockResolvedValue(1),
  };
}

describe("describeAnalysisFailure", () => {
  it("does not expose arbitrary non-error values", () => {
    expect(describeAnalysisFailure({ transcript: "sensitive content" })).toEqual({
      code: "analysis_failed",
      message: "Meeting analysis failed.",
    });
  });
});

function claim(attempt: number) {
  return {
    status: "claimed" as const,
    meetingId,
    runId: runId(attempt),
    attempt,
    input,
  };
}

function runId(attempt: number): string {
  return `00000000-0000-4000-8000-00000000000${attempt}`;
}

function repositoryMock() {
  return {
    claimAnalysis: vi.fn<MeetingAnalysisRepository["claimAnalysis"]>(),
    persistDraft: vi.fn<MeetingAnalysisRepository["persistDraft"]>(),
    recordFailure: vi.fn<MeetingAnalysisRepository["recordFailure"]>(),
    markHumanOwned: vi.fn<MeetingAnalysisRepository["markHumanOwned"]>(),
  };
}
