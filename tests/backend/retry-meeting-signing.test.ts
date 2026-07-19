import { describe, expect, it, vi } from "vitest";
import type { MeetingSigningRepository } from "../../src/backend/repositories/signing/meetingSigningRepository";
import { createMeetingSigningService } from "../../src/backend/services/signing/retryMeetingSigning";
import { eleanorId, meetingId } from "../helpers/meetingApproval";

describe("meeting signing retry service", () => {
  it("runs signing only after the database accepts the locked-PDF retry", async () => {
    const repository = repositoryMock();
    const processSigning = vi.fn().mockResolvedValue({ status: "completed" });
    const service = createMeetingSigningService({ repository, processSigning });
    const command = { meetingId, expectedVersion: 8, actorProfileId: eleanorId };

    await expect(service.retryMeetingSigning(command)).resolves.toMatchObject({
      status: "retry_started",
      meetingId,
      version: 9,
      documentVersion: 4,
    });
    expect(repository.retryDelivery).toHaveBeenCalledWith(command);
    expect(processSigning).toHaveBeenCalledWith(meetingId);
  });

  it.each(["not_found", "conflict", "invalid_actor", "invalid_state"] as const)(
    "does not contact Firma when retry persistence returns %s",
    async (status) => {
      const repository = repositoryMock();
      repository.retryDelivery = vi.fn().mockResolvedValue({
        status,
        meetingId,
        version: null,
        pdfId: null,
        documentVersion: null,
      });
      const processSigning = vi.fn();
      const service = createMeetingSigningService({ repository, processSigning });

      await expect(service.retryMeetingSigning({
        meetingId,
        expectedVersion: 8,
        actorProfileId: eleanorId,
      })).resolves.toMatchObject({ status });
      expect(processSigning).not.toHaveBeenCalled();
    },
  );

  it("validates the retry command before reaching persistence", async () => {
    const repository = repositoryMock();
    const service = createMeetingSigningService({ repository, processSigning: vi.fn() });
    await expect(service.retryMeetingSigning({
      meetingId,
      expectedVersion: 0,
      actorProfileId: eleanorId,
    })).rejects.toThrow();
    expect(repository.retryDelivery).not.toHaveBeenCalled();
  });
});

function repositoryMock(): MeetingSigningRepository {
  return {
    claimDelivery: vi.fn(),
    recordRequestCreated: vi.fn(),
    completeDelivery: vi.fn(),
    recordFailure: vi.fn(),
    retryDelivery: vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 9,
      pdfId: "33333333-3333-4333-8333-333333333333",
      documentVersion: 4,
    }),
  };
}
