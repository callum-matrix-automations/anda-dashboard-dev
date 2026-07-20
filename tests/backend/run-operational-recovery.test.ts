import { describe, expect, it, vi } from "vitest";
import { createOperationalRecoveryRunner } from "../../src/backend/services/operations/runOperationalRecovery";

const completedMeetingId = "11111111-1111-4111-8111-111111111111";
const failedMeetingId = "22222222-2222-4222-8222-222222222222";

describe("operational recovery runner", () => {
  it("coordinates signing, bounded archive recovery, and alert delivery", async () => {
    const reconcileSigning = vi.fn().mockResolvedValue({
      processed: 0,
      recovered: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      results: [],
    });
    const recoverArchive = vi.fn().mockResolvedValue({
      processed: 2,
      results: [
        { status: "completed", meetingId: completedMeetingId, attempt: 2, signedPdfId: "pdf-id" },
        {
          status: "failed",
          meetingId: failedMeetingId,
          attempt: 3,
          error: { code: "archive_storage_failed", message: "Private provider detail" },
        },
      ],
    });
    const dispatchAlerts = vi.fn().mockResolvedValue({
      status: "completed",
      processed: 1,
      delivered: 1,
      retryScheduled: 0,
      exhausted: 0,
      stale: 0,
    });
    const run = createOperationalRecoveryRunner({
      reconcileSigning,
      recoverArchive,
      dispatchAlerts,
    });

    await expect(run({
      signingAgeMinutes: 15,
      signingLimit: 10,
      signingMaxAttempts: 4,
      archiveLimit: 12,
      archiveMaxAttempts: 3,
      alertLimit: 8,
      alertMaxAttempts: 3,
      alertRetryDelaySeconds: 45,
    })).resolves.toMatchObject({ archive: { processed: 2 }, alerts: { delivered: 1 } });

    expect(reconcileSigning).toHaveBeenCalledWith({ ageMinutes: 15, limit: 10, maxAttempts: 4 });
    expect(recoverArchive).toHaveBeenCalledWith(12, 3);
    expect(dispatchAlerts).toHaveBeenCalledWith({ limit: 8, maxAttempts: 3, retryDelaySeconds: 45 });
  });

  it("does not require Telegram configuration to complete recovery", async () => {
    const run = createOperationalRecoveryRunner({
      reconcileSigning: vi.fn().mockResolvedValue({
        processed: 0,
        recovered: 0,
        pending: 0,
        failed: 0,
        skipped: 0,
        results: [],
      }),
      recoverArchive: vi.fn().mockResolvedValue({
        processed: 1,
        results: [{
          status: "failed",
          meetingId: failedMeetingId,
          attempt: 3,
          error: { code: "archive_failed", message: "Sensitive storage response" },
        }],
      }),
      dispatchAlerts: vi.fn().mockResolvedValue({
        status: "not_configured",
        processed: 0,
        delivered: 0,
        retryScheduled: 0,
        exhausted: 0,
        stale: 0,
      }),
    });

    await expect(run()).resolves.toMatchObject({ archive: { processed: 1 } });
  });
});
