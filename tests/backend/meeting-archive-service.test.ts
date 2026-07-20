import { describe, expect, it, vi } from "vitest";
import type { MeetingArchiveRepository } from "../../src/backend/repositories/archive/meetingArchiveRepository";
import type { MeetingArchiveStorage } from "../../src/backend/repositories/storage/meetingArchiveStorage";
import { createMeetingArchiveRecovery } from "../../src/backend/services/archive/recoverMeetingArchives";
import { createMeetingArchiveService } from "../../src/backend/services/archive/meetingArchiveService";

const meetingId = "11111111-1111-4111-8111-111111111111";
const pdfId = "22222222-2222-4222-8222-222222222222";

describe("meeting archive read and recovery services", () => {
  it("returns safe archive details and creates only short-lived document access", async () => {
    const repository = repositoryMock();
    const storage: MeetingArchiveStorage = {
      storeSignedPdf: vi.fn(),
      removeObject: vi.fn(),
      createTemporaryDownload: vi.fn().mockResolvedValue({
        url: "https://supabase.example.test/storage/v1/object/sign/meeting-minutes/file?token=test",
        expiresAt: "2026-07-20T14:05:00.000Z",
      }),
    };
    const service = createMeetingArchiveService({ repository, storage, signedUrlSeconds: 300 });

    await expect(service.get(meetingId)).resolves.toEqual({
      status: "available",
      archive: archiveDetail(),
    });
    await expect(service.createDocumentAccess(meetingId)).resolves.toEqual({
      status: "available",
      access: {
        meetingId,
        pdfId,
        url: "https://supabase.example.test/storage/v1/object/sign/meeting-minutes/file?token=test",
        expiresAt: "2026-07-20T14:05:00.000Z",
      },
    });
    expect(storage.createTemporaryDownload).toHaveBeenCalledWith("signed/path.pdf", 300);
  });

  it("recovers every durable ARCHIVE_FAILED candidate through the same processor", async () => {
    const repository = repositoryMock();
    repository.listRecoveryCandidates = vi.fn().mockResolvedValue([meetingId, pdfId]);
    const processor = vi.fn().mockImplementation(async (id: string) => ({
      status: "completed",
      meetingId: id,
      attempt: 2,
      signedPdfId: pdfId,
    }));
    const recover = createMeetingArchiveRecovery({ repository, processor });

    await expect(recover(10)).resolves.toMatchObject({ processed: 2 });
    expect(processor.mock.calls).toEqual([[meetingId], [pdfId]]);
  });
});

function repositoryMock(): MeetingArchiveRepository {
  return {
    claim: vi.fn(),
    complete: vi.fn(),
    recordFailure: vi.fn(),
    listRecoveryCandidates: vi.fn().mockResolvedValue([]),
    search: vi.fn(),
    get: vi.fn().mockResolvedValue({
      status: "available",
      archive: { ...archiveDetail(), storagePath: "signed/path.pdf" },
    }),
  };
}

function archiveDetail() {
  return {
    meetingId,
    title: "ANDA Board Meeting",
    meetingDate: "2026-07-20",
    category: "Board Meeting" as const,
    tags: ["budget"],
    signedBy: "33333333-3333-4333-8333-333333333333",
    signedAt: "2026-07-20T13:00:00.000Z",
    signedPdfId: pdfId,
    completedAt: "2026-07-20T14:00:00.000Z",
    version: 8,
    minutes: { summary: "Approved." },
    motions: [{
      id: "44444444-4444-4444-8444-444444444444",
      text: "Approve the budget",
      outcome: "CARRIED" as const,
    }],
    document: {
      pdfId,
      sha256: "a".repeat(64),
      sizeBytes: 12_000,
      pageCount: 3,
      documentVersion: 7,
    },
  };
}
