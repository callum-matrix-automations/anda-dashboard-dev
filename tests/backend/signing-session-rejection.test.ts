import { describe, expect, it, vi } from "vitest";
import type { SigningRequestProvider } from "../../src/backend/integrations/signing/signingRequestProvider";
import type { MeetingSigningOutcomeRepository } from "../../src/backend/repositories/signing/meetingSigningOutcomeRepository";
import type { MeetingReviewDetail } from "../../src/shared/contracts/meetingReview";
import { createCheckMeetingSigningStatusService } from "../../src/backend/services/signing/checkMeetingSigningStatus";
import {
  createMeetingSigningSessionRecordService,
  createMeetingSigningSessionService,
} from "../../src/backend/services/signing/getMeetingSigningSession";
import { createRejectMeetingSigningService } from "../../src/backend/services/signing/rejectMeetingSigning";
import { createRetryMeetingSigningOutcomeService } from "../../src/backend/services/signing/retryMeetingSigningOutcome";

const meetingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const actorProfileId = "44444444-4444-4444-8444-444444444444";

describe("meeting signing session", () => {
  it("reads workflow state without contacting Firma", async () => {
    const repository = repositoryMock();
    const getRecord = createMeetingSigningSessionRecordService({ repository });

    await expect(getRecord(meetingId)).resolves.toMatchObject({
      status: "available",
      meetingId,
      outcomeStatus: "AWAITING",
    });
    expect(repository.getSession).toHaveBeenCalledWith(meetingId);
  });

  it("returns the Firma public signing URL for the configured Treasurer recipient", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    const getSession = createMeetingSigningSessionService({
      repository,
      provider,
      signerEmail: "treasurer@example.test",
    });
    await expect(getSession(meetingId)).resolves.toEqual({
      status: "available",
      meetingId,
      requestId,
      externalRequestId: "firma-request-1",
      documentVersion: 4,
      outcomeStatus: "AWAITING",
      providerStatus: "in_progress",
      recipientId: "recipient/1",
      recipientEmail: "treasurer@example.test",
      signingUrl: "https://app.firma.dev/signing/recipient%2F1",
    });
  });

  it("returns database state failures without contacting Firma", async () => {
    const repository = repositoryMock();
    repository.getSession = vi.fn().mockResolvedValue({ status: "invalid_state", meetingId });
    const provider = providerMock();
    const getSession = createMeetingSigningSessionService({ repository, provider });
    await expect(getSession(meetingId)).resolves.toEqual({ status: "invalid_state", meetingId });
    expect(provider.getRequest).not.toHaveBeenCalled();
  });

  it("refuses to create a session for a different recipient", async () => {
    const provider = providerMock();
    provider.getRequest = vi.fn().mockResolvedValue({
      id: "firma-request-1",
      status: "in_progress",
      recipients: [{ id: "other", email: "other@example.test", finishedAt: null, declinedAt: null }],
      completedAt: null,
    });
    const getSession = createMeetingSigningSessionService({
      repository: repositoryMock(),
      provider,
      signerEmail: "treasurer@example.test",
    });
    await expect(getSession(meetingId)).rejects.toThrow("not a recipient");
  });
});

describe("signing status check", () => {
  const command = {
    meetingId,
    expectedVersion: 8,
    actorProfileId,
  };

  it("reconciles an active signing request without changing its workflow prematurely", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      status: "no_change",
      meetingId,
      attempt: 2,
      providerStatus: "in_progress",
    });
    const checkStatus = createCheckMeetingSigningStatusService({
      getMeeting: vi.fn().mockResolvedValue({
        id: meetingId,
        status: "AWAITING_SIGNATURE",
        version: 8,
      } as MeetingReviewDetail),
      reconcile,
    });

    await expect(checkStatus(command)).resolves.toEqual({
      status: "checked",
      meetingId,
      version: 8,
      attempt: 2,
      reconciliation: {
        status: "no_change",
        meetingId,
        attempt: 2,
        providerStatus: "in_progress",
      },
    });
    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });

  it("does not reconcile a stale browser version", async () => {
    const reconcile = vi.fn();
    const checkStatus = createCheckMeetingSigningStatusService({
      getMeeting: vi.fn().mockResolvedValue({
        id: meetingId,
        status: "AWAITING_SIGNATURE",
        version: 9,
      } as MeetingReviewDetail),
      reconcile,
    });

    await expect(checkStatus(command)).resolves.toEqual({
      status: "conflict",
      meetingId,
      version: 9,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("keeps failed completion recovery on the dedicated retry path", async () => {
    const reconcile = vi.fn();
    const checkStatus = createCheckMeetingSigningStatusService({
      getMeeting: vi.fn().mockResolvedValue({
        id: meetingId,
        status: "ESIGN_FAILED",
        version: 8,
      } as MeetingReviewDetail),
      reconcile,
    });

    await expect(checkStatus(command)).resolves.toEqual({
      status: "invalid_state",
      meetingId,
      version: 8,
    });
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("meeting signing rejection", () => {
  const command = {
    meetingId,
    expectedVersion: 8,
    actorProfileId,
    comment: "Please correct the recorded motion outcome.",
  };

  it("cancels Firma before atomically returning the meeting for correction", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    const reject = createRejectMeetingSigningService({ repository, provider });
    await expect(reject(command)).resolves.toEqual({
      status: "rejected",
      meetingId,
      version: 9,
      documentVersion: 4,
    });
    expect(provider.cancelRequest).toHaveBeenCalledWith(
      "firma-request-1",
      "Please correct the recorded motion outcome.",
    );
    expect(repository.completeRejection).toHaveBeenCalledWith(requestId, runId);
  });

  it.each(["not_found", "invalid_actor", "comment_required", "conflict", "invalid_state"] as const)(
    "does not contact Firma when the rejection claim is %s",
    async (status) => {
      const repository = repositoryMock();
      repository.claimRejection = vi.fn().mockResolvedValue({
        status,
        meetingId,
        version: status === "not_found" ? null : 8,
      });
      const provider = providerMock();
      const reject = createRejectMeetingSigningService({ repository, provider });
      await expect(reject(command)).resolves.toMatchObject({ status });
      expect(provider.cancelRequest).not.toHaveBeenCalled();
    },
  );

  it("records a retryable rejection failure without unlocking approved content", async () => {
    const repository = repositoryMock();
    const provider = providerMock();
    provider.cancelRequest = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const reject = createRejectMeetingSigningService({ repository, provider });
    await expect(reject(command)).resolves.toMatchObject({
      status: "failed",
      meetingId,
      version: 8,
      error: { code: "esign_rejection_failed", message: "provider unavailable" },
    });
    expect(repository.recordRejectionFailure).toHaveBeenCalledWith(requestId, runId, {
      code: "esign_rejection_failed",
      message: "provider unavailable",
    });
    expect(repository.completeRejection).not.toHaveBeenCalled();
  });
});

describe("signing outcome retry", () => {
  it("reconciles only after the database authorises a Treasurer retry", async () => {
    const repository = repositoryMock();
    repository.retryOutcome = vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 9,
      documentVersion: 4,
    });
    const reconcile = vi.fn().mockResolvedValue({
      status: "no_change",
      meetingId,
      attempt: 2,
      providerStatus: "in_progress",
    });
    const retry = createRetryMeetingSigningOutcomeService({ repository, reconcile });
    await expect(retry({ meetingId, expectedVersion: 8, actorProfileId })).resolves.toMatchObject({
      status: "retry_started",
      reconciliation: { status: "no_change" },
    });
    expect(reconcile).toHaveBeenCalledWith(meetingId);
  });

  it("does not reconcile an invalid or stale retry", async () => {
    const repository = repositoryMock();
    repository.retryOutcome = vi.fn().mockResolvedValue({
      status: "invalid_state",
      meetingId,
      version: 8,
    });
    const reconcile = vi.fn();
    const retry = createRetryMeetingSigningOutcomeService({ repository, reconcile });
    await expect(retry({ meetingId, expectedVersion: 8, actorProfileId })).resolves.toMatchObject({
      status: "invalid_state",
    });
    expect(reconcile).not.toHaveBeenCalled();
  });
});

function repositoryMock(): MeetingSigningOutcomeRepository {
  return {
    receiveWebhook: vi.fn(),
    claimWebhook: vi.fn(),
    claimReconciliation: vi.fn(),
    completeOutcome: vi.fn(),
    completeNoChange: vi.fn(),
    recordOutcomeFailure: vi.fn(),
    getSession: vi.fn().mockResolvedValue({
      status: "available",
      meetingId,
      requestId,
      externalRequestId: "firma-request-1",
      documentVersion: 4,
      outcomeStatus: "AWAITING",
      recipientEmail: null,
    }),
    claimRejection: vi.fn().mockResolvedValue({
      status: "claimed",
      meetingId,
      requestId,
      externalRequestId: "firma-request-1",
      runId,
      version: 8,
      documentVersion: 4,
    }),
    completeRejection: vi.fn().mockResolvedValue({
      status: "rejected",
      meetingId,
      version: 9,
      documentVersion: 4,
    }),
    recordRejectionFailure: vi.fn().mockResolvedValue("failed"),
    retryOutcome: vi.fn(),
  };
}

function providerMock(): SigningRequestProvider {
  return {
    findRequest: vi.fn(),
    createRequest: vi.fn(),
    sendRequest: vi.fn(),
    getRequest: vi.fn().mockResolvedValue({
      id: "firma-request-1",
      status: "in_progress",
      recipients: [{
        id: "recipient/1",
        email: "treasurer@example.test",
        finishedAt: null,
        declinedAt: null,
      }],
      completedAt: null,
    }),
    downloadCompletedDocument: vi.fn(),
    cancelRequest: vi.fn().mockResolvedValue(undefined),
  };
}
