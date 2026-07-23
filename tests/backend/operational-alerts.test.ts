import { describe, expect, it, vi } from "vitest";
import {
  createTelegramOperationalAlertProvider,
  formatTelegramOperationalAlert,
} from "../../src/backend/integrations/alerts/telegramOperationalAlertProvider";
import type { OperationalAlertRepository } from "../../src/backend/repositories/operations/operationalAlertRepository";
import { createOperationalAlertDispatcher } from "../../src/backend/services/operations/dispatchOperationalAlerts";
import { createStaleSigningReconciliation } from "../../src/backend/services/operations/reconcileStaleMeetingSignings";
import { safelyRecordOperationalFailure } from "../../src/backend/services/operations/operationalAlertService";
import type { OperationalAlertDeliveryClaim } from "../../src/shared/contracts/operationalAlerts";

const meetingId = "11111111-1111-4111-8111-111111111111";
const secondMeetingId = "22222222-2222-4222-8222-222222222222";

describe("operational alerts", () => {
  it("sends a safe plain-text Telegram message without provider payloads or document content", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({ ok: true, result: { message_id: 1 } }));
    const provider = createTelegramOperationalAlertProvider({
      botToken: "123456:test-token",
      chatId: "-100123456",
      apiBaseUrl: "https://telegram.example.test",
      fetchImplementation,
    });

    await provider.send(claim());

    const request = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(request[1].body));
    expect(request[0].toString()).toContain("/bot123456:test-token/sendMessage");
    expect(body).toEqual(expect.objectContaining({ chat_id: "-100123456" }));
    expect(body.text).toContain(`Meeting ID: ${meetingId}`);
    expect(body.text).toContain("Failure: archive_storage_failed");
    expect(body.text).not.toContain("transcript");
    expect(body.text).not.toContain("@example");
    expect(body.text).not.toContain("%PDF");
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("formats only the approved operational fields", () => {
    expect(formatTelegramOperationalAlert(claim())).toBe([
      "ANDA operational alert",
      "Stage: ARCHIVE",
      "Failure: archive_storage_failed",
      "Status: ARCHIVE_FAILED",
      `Meeting ID: ${meetingId}`,
      "Occurred: 2026-07-20T12:00:00.000Z",
    ].join("\n"));
  });

  it("does not claim alerts until Telegram is configured", async () => {
    const repository = repositoryMock();
    const dispatch = createOperationalAlertDispatcher({
      repository,
      provider: { isConfigured: () => false, send: vi.fn() },
    });

    await expect(dispatch()).resolves.toMatchObject({ status: "not_configured", processed: 0 });
    expect(repository.claimDeliveries).not.toHaveBeenCalled();
  });

  it("contains alert persistence failures without exposing their error message", async () => {
    const logger = { error: vi.fn() };
    await expect(safelyRecordOperationalFailure({
      recordFailure: vi.fn().mockRejectedValue(new Error("database response contains a secret")),
      resolveFailure: vi.fn(),
    }, {
      stage: "ARCHIVE",
      meetingId,
      failureCode: "archive_failed",
      workflowStatus: "ARCHIVE_FAILED",
    }, logger)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Operational alert could not be recorded",
      expect.objectContaining({ reason: "operational_alert_persistence_failed" }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("database response contains a secret");
  });

  it("records successful, retryable, and exhausted Telegram deliveries independently", async () => {
    const repository = repositoryMock();
    repository.claimDeliveries = vi.fn().mockResolvedValue([
      claim(),
      claim({ alertId: secondMeetingId, runId: "33333333-3333-4333-8333-333333333333" }),
      claim({ alertId: "44444444-4444-4444-8444-444444444444", runId: "55555555-5555-4555-8555-555555555555" }),
    ]);
    repository.recordDeliveryFailure = vi.fn()
      .mockResolvedValueOnce("retry_scheduled")
      .mockResolvedValueOnce("exhausted");
    const send = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("network includes secret payload"))
      .mockRejectedValueOnce(new Error("still down"));
    const dispatch = createOperationalAlertDispatcher({
      repository,
      provider: { isConfigured: () => true, send },
    });

    await expect(dispatch({ maxAttempts: 3, retryDelaySeconds: 45 })).resolves.toEqual({
      status: "completed",
      processed: 3,
      delivered: 1,
      retryScheduled: 1,
      exhausted: 1,
      stale: 0,
    });
    expect(repository.completeDelivery).toHaveBeenCalledOnce();
    expect(repository.recordDeliveryFailure).toHaveBeenNthCalledWith(
      1,
      secondMeetingId,
      "33333333-3333-4333-8333-333333333333",
      "alert_delivery_failed",
      45,
      3,
    );
  });

  it("reconciles a bounded stale-signing batch and alerts only terminal or exhausted failures", async () => {
    const repository = repositoryMock();
    repository.claimStaleSigningCandidates = vi.fn().mockResolvedValue([
      signingClaim(meetingId, 2),
      signingClaim(secondMeetingId, 2),
      signingClaim("33333333-3333-4333-8333-333333333333", 5),
      signingClaim("44444444-4444-4444-8444-444444444444", 2),
    ]);
    const processClaim = vi.fn()
      .mockResolvedValueOnce({
        status: "ready_for_archive",
        meetingId,
        attempt: 2,
        documentSha256: "a".repeat(64),
        documentSizeBytes: 100,
      })
      .mockResolvedValueOnce({
        status: "no_change",
        meetingId: secondMeetingId,
        attempt: 2,
        providerStatus: "pending",
      })
      .mockResolvedValueOnce({
        status: "failed",
        meetingId: "33333333-3333-4333-8333-333333333333",
        attempt: 5,
        error: { code: "firma_document_not_ready", message: "Not ready" },
        retryable: true,
      })
      .mockResolvedValueOnce({
        status: "failed",
        meetingId: "44444444-4444-4444-8444-444444444444",
        attempt: 2,
        error: { code: "firma_request_declined", message: "Declined" },
        retryable: false,
      });
    const alerts = { recordFailure: vi.fn(), resolveFailure: vi.fn().mockResolvedValue(1) };
    const run = createStaleSigningReconciliation({ repository, processClaim, alerts });

    await expect(run({ ageMinutes: 15, limit: 10, maxAttempts: 5 })).resolves.toMatchObject({
      processed: 4,
      recovered: 1,
      pending: 1,
      failed: 2,
      skipped: 0,
    });
    expect(repository.claimStaleSigningCandidates).toHaveBeenCalledWith(15, 10, 5);
    expect(alerts.resolveFailure).toHaveBeenCalledWith({ stage: "SIGNING", meetingId });
    expect(alerts.recordFailure).toHaveBeenCalledTimes(2);
  });
});

function claim(overrides: Partial<OperationalAlertDeliveryClaim> = {}): OperationalAlertDeliveryClaim {
  return {
    alertId: "66666666-6666-4666-8666-666666666666",
    runId: "77777777-7777-4777-8777-777777777777",
    stage: "ARCHIVE",
    meetingId,
    entityRef: null,
    failureCode: "archive_storage_failed",
    workflowStatus: "ARCHIVE_FAILED",
    occurredAt: "2026-07-20T12:00:00.000Z",
    attempt: 1,
    ...overrides,
  };
}

function repositoryMock(): OperationalAlertRepository {
  return {
    record: vi.fn(),
    resolve: vi.fn(),
    claimDeliveries: vi.fn().mockResolvedValue([]),
    completeDelivery: vi.fn().mockResolvedValue("saved"),
    recordDeliveryFailure: vi.fn().mockResolvedValue("retry_scheduled"),
    createIssueReport: vi.fn(),
    claimStaleSigningCandidates: vi.fn().mockResolvedValue([]),
    listStaleSigningCandidates: vi.fn().mockResolvedValue([]),
  };
}

function signingClaim(id: string, attempt: number) {
  return {
    status: "claimed" as const,
    eventId: null,
    eventRecordId: null,
    meetingId: id,
    requestId: "88888888-8888-4888-8888-888888888888",
    externalRequestId: `firma-${id}`,
    documentVersion: 1,
    runId: "99999999-9999-4999-8999-999999999999",
    attempt,
  };
}
