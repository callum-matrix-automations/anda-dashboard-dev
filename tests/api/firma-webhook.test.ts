import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingSigningOutcomeRepository } from "../../src/backend/repositories/signing/meetingSigningOutcomeRepository";
import {
  createFirmaWebhookHandler,
  extractSigningRequestId,
  FIRMA_EVENT_HEADER,
} from "../../src/backend/integrations/webhooks/firmaWebhookHandler";
import {
  createFirmaWebhookSignature,
  FIRMA_SIGNATURE_HEADER,
  verifyFirmaWebhookSignature,
} from "../../src/backend/integrations/webhooks/firmaWebhookAuth";

const secret = "firma-webhook-test-secret";
const eventRecordId = "44444444-4444-4444-8444-444444444444";
const meetingId = "11111111-1111-4111-8111-111111111111";
const event = {
  id: "evt_firma_completed_1",
  type: "signing_request.completed",
  data: { signing_request: { id: "firma-request-1" } },
};

describe("Firma webhook authentication", () => {
  it("accepts a valid Firma t/v1 HMAC signature", () => {
    const rawBody = JSON.stringify(event);
    const timestamp = "1784505600";
    expect(verifyFirmaWebhookSignature({
      currentSecret: secret,
      signatureHeader: header(secret, timestamp, rawBody),
      oldSignatureHeader: null,
      rawBody,
      now: () => new Date(Number(timestamp) * 1_000),
    })).toEqual({ ok: true });
  });

  it("accepts the old signature only with the configured previous secret", () => {
    const rawBody = JSON.stringify(event);
    const timestamp = "1784505600";
    expect(verifyFirmaWebhookSignature({
      currentSecret: "new-secret",
      previousSecret: "old-secret",
      signatureHeader: header("wrong-secret", timestamp, rawBody),
      oldSignatureHeader: header("old-secret", timestamp, rawBody),
      rawBody,
      now: () => new Date(Number(timestamp) * 1_000),
    })).toEqual({ ok: true });
  });

  it.each([
    ["missing", null, "1784505600"],
    ["incorrect", "t=1784505600,v1=" + "0".repeat(64), "1784505600"],
    ["expired", header(secret, "1784505000", JSON.stringify(event)), "1784505600"],
    ["future", header(secret, "1784506200", JSON.stringify(event)), "1784505600"],
  ])("rejects a %s signature", (_name, signatureHeader, now) => {
    expect(verifyFirmaWebhookSignature({
      currentSecret: secret,
      signatureHeader,
      oldSignatureHeader: null,
      rawBody: JSON.stringify(event),
      now: () => new Date(Number(now) * 1_000),
    })).toMatchObject({ ok: false });
  });
});

describe("Firma webhook handler", () => {
  beforeEach(() => {
    process.env.FIRMA_WEBHOOK_SECRET = secret;
  });

  afterEach(() => {
    delete process.env.FIRMA_WEBHOOK_SECRET;
    delete process.env.FIRMA_WEBHOOK_SECRET_PREVIOUS;
  });

  it("persists a valid event, acknowledges quickly, and schedules outcome processing", async () => {
    const repository = repositoryMock();
    const processEvent = vi.fn().mockResolvedValue({ status: "ready_for_archive" });
    const scheduled: Array<() => Promise<void>> = [];
    const handler = createFirmaWebhookHandler({
      repository,
      processEvent,
      schedule: (work) => scheduled.push(work),
    });
    const rawBody = JSON.stringify(event);

    const response = await handler(signedRequest(rawBody));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ status: "accepted", meetingId });
    expect(repository.receiveWebhook).toHaveBeenCalledWith(
      event,
      "firma-request-1",
      createHash("sha256").update(rawBody).digest("hex"),
    );
    expect(processEvent).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
    expect(processEvent).toHaveBeenCalledWith(event.id);
  });

  it("acknowledges Firma's signed webhook health check without persisting it", async () => {
    const repository = repositoryMock();
    const processEvent = vi.fn();
    const rawBody = JSON.stringify({ message: "This is a test webhook event" });
    const response = await createFirmaWebhookHandler({ repository, processEvent })(
      signedRequest(rawBody, { [FIRMA_EVENT_HEADER]: "webhook.test" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "verified" });
    expect(repository.receiveWebhook).not.toHaveBeenCalled();
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("stores recipient-signed evidence without scheduling final-document processing", async () => {
    const repository = repositoryMock();
    repository.receiveWebhook = vi.fn().mockResolvedValue({
      status: "ignored",
      eventRecordId,
      meetingId,
    });
    const schedule = vi.fn();
    const signedEvent = {
      id: "evt_firma_recipient_signed_1",
      type: "signing_request.recipient.signed",
      data: { signing_request: { id: "firma-request-1" } },
    };
    const response = await createFirmaWebhookHandler({ repository, schedule })(
      signedRequest(JSON.stringify(signedEvent)),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ignored", meetingId });
    expect(repository.receiveWebhook).toHaveBeenCalledWith(
      signedEvent,
      "firma-request-1",
      expect.stringMatching(/^[a-f0-9]{64}$/u),
    );
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not schedule an already-processed duplicate", async () => {
    const repository = repositoryMock();
    repository.receiveWebhook = vi.fn().mockResolvedValue({
      status: "duplicate",
      eventRecordId,
      meetingId,
    });
    const processEvent = vi.fn();
    const handler = createFirmaWebhookHandler({ repository, processEvent, schedule: vi.fn() });
    const response = await handler(signedRequest(JSON.stringify(event)));
    expect(response.status).toBe(200);
    expect(processEvent).not.toHaveBeenCalled();
  });

  it("schedules a failed duplicate so Firma delivery retries can recover it", async () => {
    const repository = repositoryMock();
    repository.receiveWebhook = vi.fn().mockResolvedValue({
      status: "retry",
      eventRecordId,
      meetingId,
    });
    const scheduled = vi.fn();
    const handler = createFirmaWebhookHandler({ repository, schedule: scheduled });
    const response = await handler(signedRequest(JSON.stringify(event)));
    expect(response.status).toBe(202);
    expect(scheduled).toHaveBeenCalledOnce();
  });

  it("rejects invalid authentication before parsing or persistence", async () => {
    const repository = repositoryMock();
    const handler = createFirmaWebhookHandler({ repository });
    const response = await handler(new Request("http://localhost/api/webhooks/firma", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { [FIRMA_SIGNATURE_HEADER]: "t=1,v1=" + "0".repeat(64) },
    }));
    expect(response.status).toBe(401);
    expect(repository.receiveWebhook).not.toHaveBeenCalled();
  });

  it("returns a retryable response when durable persistence fails", async () => {
    const repository = repositoryMock();
    repository.receiveWebhook = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const handler = createFirmaWebhookHandler({ repository });
    const response = await handler(signedRequest(JSON.stringify(event)));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "webhook_persistence_failed" });
  });

  it("returns conflict when the same provider event ID has different evidence", async () => {
    const repository = repositoryMock();
    repository.receiveWebhook = vi.fn().mockResolvedValue({
      status: "conflict",
      eventRecordId,
      meetingId,
    });
    const handler = createFirmaWebhookHandler({ repository });
    const response = await handler(signedRequest(JSON.stringify(event)));
    expect(response.status).toBe(409);
  });

  it("extracts request IDs from supported Firma event shapes", () => {
    expect(extractSigningRequestId(event)).toBe("firma-request-1");
    expect(extractSigningRequestId({ id: "e", type: "x", signing_request_id: "top" })).toBe("top");
    expect(extractSigningRequestId({ id: "e", type: "x", data: { signing_request_id: "flat" } })).toBe("flat");
    expect(extractSigningRequestId({ id: "e", type: "webhook.test", data: {} })).toBeNull();
  });
});

function signedRequest(rawBody: string, additionalHeaders: Record<string, string> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return new Request("http://localhost/api/webhooks/firma", {
    method: "POST",
    body: rawBody,
    headers: {
      [FIRMA_SIGNATURE_HEADER]: header(secret, timestamp, rawBody),
      ...additionalHeaders,
    },
  });
}

function header(signingSecret: string, timestamp: string, rawBody: string) {
  return `t=${timestamp},v1=${createFirmaWebhookSignature(signingSecret, timestamp, rawBody)}`;
}

function repositoryMock(): MeetingSigningOutcomeRepository {
  return {
    receiveWebhook: vi.fn().mockResolvedValue({ status: "accepted", eventRecordId, meetingId }),
    claimWebhook: vi.fn(),
    claimReconciliation: vi.fn(),
    completeOutcome: vi.fn(),
    completeNoChange: vi.fn(),
    recordOutcomeFailure: vi.fn(),
    getSession: vi.fn(),
    claimRejection: vi.fn(),
    completeRejection: vi.fn(),
    recordRejectionFailure: vi.fn(),
    retryOutcome: vi.fn(),
  };
}
