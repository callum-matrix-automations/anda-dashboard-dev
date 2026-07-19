import { describe, expect, it, vi } from "vitest";
import type { MeetingApprovalRepository } from "../../src/backend/repositories/approvals/meetingApprovalRepository";
import { createMeetingApprovalService } from "../../src/backend/services/approvals/approveMeeting";
import { eleanorId, meetingId } from "../helpers/meetingApproval";

describe("meeting approval service", () => {
  it("processes PDF generation only after an accepted approval", async () => {
    const repository = repositoryMock();
    const processPdf = pdfProcessorMock();
    const processSigning = signingProcessorMock();
    const service = createMeetingApprovalService({ repository, processPdf, processSigning });
    const command = {
      meetingId,
      expectedVersion: 4,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    };

    await expect(service.approveMeeting(command)).resolves.toMatchObject({ status: "approved" });
    expect(repository.approve).toHaveBeenCalledWith(command);
    expect(processPdf).toHaveBeenCalledWith(meetingId);
    expect(processSigning).toHaveBeenCalledWith(meetingId);
  });

  it("does not schedule when acknowledgement is required", async () => {
    const repository = repositoryMock();
    repository.approve = vi.fn().mockResolvedValue({
      status: "acknowledgement_required",
      meetingId,
      version: 4,
      unresolvedVoteCount: 1,
      documentVersion: 4,
    });
    const processPdf = pdfProcessorMock();
    const processSigning = signingProcessorMock();
    const service = createMeetingApprovalService({ repository, processPdf, processSigning });

    await service.approveMeeting({
      meetingId,
      expectedVersion: 4,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: false,
    });
    expect(processPdf).not.toHaveBeenCalled();
    expect(processSigning).not.toHaveBeenCalled();
  });

  it("processes retry only after PDF_FAILED accepts it", async () => {
    const repository = repositoryMock();
    const processPdf = pdfProcessorMock();
    const processSigning = signingProcessorMock();
    const service = createMeetingApprovalService({ repository, processPdf, processSigning });

    await expect(service.retryMeetingPdf({
      meetingId,
      expectedVersion: 8,
      actorProfileId: eleanorId,
    })).resolves.toMatchObject({ status: "retry_started" });
    expect(processPdf).toHaveBeenCalledWith(meetingId);
    expect(processSigning).toHaveBeenCalledWith(meetingId);
  });

  it("does not start signing when PDF generation did not complete", async () => {
    const repository = repositoryMock();
    const processPdf = vi.fn().mockResolvedValue({
      status: "failed",
      meetingId,
      attempt: 1,
      error: { code: "pdf_generation_failed", message: "Render failed." },
    });
    const processSigning = signingProcessorMock();
    const service = createMeetingApprovalService({ repository, processPdf, processSigning });

    await service.approveMeeting({
      meetingId,
      expectedVersion: 4,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    });
    expect(processSigning).not.toHaveBeenCalled();
  });
});

function repositoryMock(): MeetingApprovalRepository {
  return {
    approve: vi.fn().mockResolvedValue({
      status: "approved",
      meetingId,
      version: 5,
      unresolvedVoteCount: 0,
      documentVersion: 4,
    }),
    retryPdf: vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 9,
      documentVersion: 4,
    }),
    claimPdfGeneration: vi.fn(),
    completePdfGeneration: vi.fn(),
    recordPdfFailure: vi.fn(),
  };
}

function pdfProcessorMock() {
  return vi.fn().mockResolvedValue({
    status: "completed" as const,
    meetingId,
    attempt: 1,
    path: "unsigned/meeting/v4/minutes.pdf",
  });
}

function signingProcessorMock() {
  return vi.fn().mockResolvedValue({
    status: "completed" as const,
    meetingId,
    attempt: 1,
    externalRequestId: "firma-request-1",
  });
}
