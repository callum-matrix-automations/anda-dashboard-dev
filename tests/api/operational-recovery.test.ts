import { describe, expect, it, vi } from "vitest";
import {
  createOperationalRecoveryHandler,
  createReportOperationalIssueHandler,
} from "../../src/backend/integrations/operations/operationalHandlers";

const secret = "a-long-dedicated-scheduler-secret";
const meetingId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
const actorResolver = vi.fn().mockResolvedValue({
  profileId,
  displayName: "Active Member",
  role: "USER" as const,
  isAdmin: false,
});

describe("operational recovery APIs", () => {
  it("rejects missing and invalid scheduler secrets", async () => {
    const run = vi.fn();
    const handler = createOperationalRecoveryHandler({ run, secret });

    expect((await handler(recoveryRequest(undefined))).status).toBe(401);
    expect((await handler(recoveryRequest("wrong-secret"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed when scheduler authentication is not configured", async () => {
    const run = vi.fn();
    const handler = createOperationalRecoveryHandler({ run, secret: "" });

    expect((await handler(recoveryRequest(secret))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs configured recovery with validated bounded overrides", async () => {
    const run = vi.fn().mockResolvedValue({ signing: {}, archive: {}, alerts: {} });
    const handler = createOperationalRecoveryHandler({
      run,
      secret,
      configuredOptions: () => ({ signingAgeMinutes: 10, signingLimit: 25 }),
    });
    const response = await handler(recoveryRequest(secret, { signingLimit: 5, alertLimit: 10 }));

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({ signingAgeMinutes: 10, signingLimit: 5, alertLimit: 10 });
    expect((await handler(recoveryRequest(secret, { archiveLimit: 101 }))).status).toBe(400);
  });

  it("creates an authenticated issue report without echoing its comment", async () => {
    const report = vi.fn().mockResolvedValue({
      status: "created",
      meetingId,
      reportId: "33333333-3333-4333-8333-333333333333",
      alertId: "44444444-4444-4444-8444-444444444444",
      alertStatus: "created",
    });
    const handler = createReportOperationalIssueHandler({ report, actorResolver });
    const response = await handler(issueRequest({ meetingId, comment: "The minutes need attention." }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(report).toHaveBeenCalledWith({
      meetingId,
      reporterProfileId: profileId,
      comment: "The minutes need attention.",
    });
    expect(JSON.stringify(body)).not.toContain("minutes need attention");
  });

  it("rejects unauthenticated, invalid, oversized, and unknown-meeting reports", async () => {
    const report = vi.fn().mockResolvedValue({ status: "not_found", meetingId });
    const unauthenticated = createReportOperationalIssueHandler({
      report,
      actorResolver: vi.fn().mockResolvedValue(null),
    });
    expect((await unauthenticated(issueRequest({ meetingId }))).status).toBe(401);

    const handler = createReportOperationalIssueHandler({ report, actorResolver });
    expect((await handler(issueRequest({ meetingId: "invalid" }))).status).toBe(400);
    expect((await handler(issueRequest({ meetingId, comment: "x".repeat(2_001) }))).status).toBe(400);
    expect((await handler(issueRequest({ meetingId }))).status).toBe(404);
  });
});

function recoveryRequest(token?: string, body: unknown = {}) {
  return new Request("https://anda.test/api/internal/operations/recover", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function issueRequest(body: unknown) {
  return new Request("https://anda.test/api/issues/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
