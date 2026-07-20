import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTelegramOperationalAlertProvider } from "../../src/backend/integrations/alerts/telegramOperationalAlertProvider";

const liveTestEnabled = process.env.RUN_TELEGRAM_LIVE_TEST === "true";

describe.skipIf(!liveTestEnabled)("live Telegram operational alert", () => {
  it("delivers one safe test alert with the configured bot and chat", async () => {
    const provider = createTelegramOperationalAlertProvider();
    expect(provider.isConfigured()).toBe(true);

    await expect(provider.send({
      alertId: randomUUID(),
      runId: randomUUID(),
      stage: "USER_REPORT",
      meetingId: null,
      entityRef: `telegram-live-test-${randomUUID()}`,
      failureCode: "telegram_live_delivery_test",
      workflowStatus: "TEST_ONLY",
      occurredAt: new Date().toISOString(),
      attempt: 1,
    })).resolves.toBeUndefined();
  }, 20_000);
});
