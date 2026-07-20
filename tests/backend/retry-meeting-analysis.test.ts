import { describe, expect, it, vi } from "vitest";
import { createMeetingAnalysisRetryService } from "../../src/backend/services/ai/retryMeetingAnalysis";

const meetingId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "22222222-2222-4222-8222-222222222222";
const command = { meetingId, expectedVersion: 7, actorProfileId };

describe("manual meeting analysis retry service", () => {
  it("atomically prepares the retry before invoking the existing analysis processor", async () => {
    const repository = {
      prepareRetry: vi.fn().mockResolvedValue({
        status: "retry_started",
        meetingId,
        version: 8,
      }),
    };
    const processAnalysis = vi.fn().mockResolvedValue({
      status: "completed",
      meetingId,
      attempt: 1,
    });
    const retry = createMeetingAnalysisRetryService({ repository, processAnalysis });

    await expect(retry(command)).resolves.toEqual({
      status: "completed",
      meetingId,
      version: null,
      attempt: 1,
    });
    expect(repository.prepareRetry).toHaveBeenCalledWith(command);
    expect(processAnalysis).toHaveBeenCalledWith(meetingId);
  });

  it.each(["not_found", "forbidden", "conflict", "protected", "invalid_state"] as const)(
    "does not start analysis when preparation returns %s",
    async (status) => {
      const repository = {
        prepareRetry: vi.fn().mockResolvedValue({ status, meetingId, version: status === "not_found" ? null : 7 }),
      };
      const processAnalysis = vi.fn();
      const retry = createMeetingAnalysisRetryService({ repository, processAnalysis });

      await expect(retry(command)).resolves.toEqual({
        status,
        meetingId,
        version: status === "not_found" ? null : 7,
        attempt: null,
      });
      expect(processAnalysis).not.toHaveBeenCalled();
    },
  );

  it("returns a safe failure after the processor exhausts its attempts", async () => {
    const repository = {
      prepareRetry: vi.fn().mockResolvedValue({ status: "retry_started", meetingId, version: 8 }),
    };
    const processAnalysis = vi.fn().mockResolvedValue({
      status: "failed",
      meetingId,
      attempts: 3,
      error: { code: "provider_secret_code", message: "Provider response with private details." },
    });
    const retry = createMeetingAnalysisRetryService({ repository, processAnalysis });

    await expect(retry(command)).resolves.toEqual({
      status: "failed",
      meetingId,
      version: null,
      attempt: 3,
    });
  });

  it("maps a post-preparation race to an invalid workflow state", async () => {
    const repository = {
      prepareRetry: vi.fn().mockResolvedValue({ status: "retry_started", meetingId, version: 8 }),
    };
    const processAnalysis = vi.fn().mockResolvedValue({
      status: "already_processing",
      meetingId,
      attempt: 1,
    });
    const retry = createMeetingAnalysisRetryService({ repository, processAnalysis });

    await expect(retry(command)).resolves.toEqual({
      status: "invalid_state",
      meetingId,
      version: null,
      attempt: 1,
    });
  });
});
