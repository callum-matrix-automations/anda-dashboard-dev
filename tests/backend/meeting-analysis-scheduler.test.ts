import { describe, expect, it, vi } from "vitest";
import { createMeetingAnalysisScheduler } from "../../src/backend/integrations/internal/meetingAnalysisScheduler";

const meetingId = "11111111-1111-4111-8111-111111111111";

describe("meeting analysis scheduler", () => {
  it("schedules analysis without waiting for it inside transcript intake", async () => {
    const processor = vi.fn().mockResolvedValue({ status: "completed", meetingId, attempt: 1 });
    let scheduledTask: (() => Promise<void>) | undefined;
    const schedule = vi.fn((task: () => Promise<void>) => { scheduledTask = task; });
    const scheduleAnalysis = createMeetingAnalysisScheduler({ processor, schedule });

    await scheduleAnalysis(meetingId);

    expect(schedule).toHaveBeenCalledOnce();
    expect(processor).not.toHaveBeenCalled();
    await scheduledTask?.();
    expect(processor).toHaveBeenCalledWith(meetingId);
  });

  it("contains unexpected background failures without exposing transcript content", async () => {
    const processor = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const logger = { error: vi.fn() };
    let scheduledTask: (() => Promise<void>) | undefined;
    const scheduleAnalysis = createMeetingAnalysisScheduler({
      processor,
      logger,
      schedule: (task) => { scheduledTask = task; },
    });

    await scheduleAnalysis(meetingId);
    await scheduledTask?.();

    expect(logger.error).toHaveBeenCalledWith(
      "Scheduled meeting analysis failed unexpectedly",
      { meetingId, reason: "database unavailable" },
    );
  });
});
