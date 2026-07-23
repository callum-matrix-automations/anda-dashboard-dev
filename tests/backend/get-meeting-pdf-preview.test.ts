import { describe, expect, it, vi } from "vitest";
import { createGetMeetingPdfPreview } from "../../src/backend/services/pdf/getMeetingPdfPreview";
import type { MeetingReviewDetail } from "../../src/shared/contracts/meetingReview";

const meetingId = "11111111-1111-4111-8111-111111111111";
const pdfPath = `unsigned/${meetingId}/v4/minutes.pdf`;

describe("meeting PDF preview service", () => {
  it("loads the associated unsigned PDF from private storage", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 test");
    const meetingReader = { getMeetingReview: vi.fn().mockResolvedValue(meetingWithPdf()) };
    const pdfSource = { loadApprovedPdf: vi.fn().mockResolvedValue(bytes) };

    await expect(createGetMeetingPdfPreview(meetingReader, pdfSource)(meetingId)).resolves.toEqual({
      status: "available",
      meetingId,
      documentVersion: 4,
      bytes,
    });
    expect(pdfSource.loadApprovedPdf).toHaveBeenCalledWith(pdfPath);
  });

  it("does not access storage when the meeting or PDF association is missing", async () => {
    const pdfSource = { loadApprovedPdf: vi.fn() };
    const missingMeeting = createGetMeetingPdfPreview(
      { getMeetingReview: vi.fn().mockResolvedValue(null) },
      pdfSource,
    );
    const missingPdf = createGetMeetingPdfPreview(
      { getMeetingReview: vi.fn().mockResolvedValue({ ...meetingWithPdf(), pdfArtifact: null }) },
      pdfSource,
    );

    await expect(missingMeeting(meetingId)).resolves.toEqual({ status: "not_found", meetingId });
    await expect(missingPdf(meetingId)).resolves.toEqual({ status: "not_ready", meetingId });
    expect(pdfSource.loadApprovedPdf).not.toHaveBeenCalled();
  });
});

function meetingWithPdf(): MeetingReviewDetail {
  return {
    id: meetingId,
    sourceMeetingId: "read_ai:meeting-1",
    title: "ANDA Board Meeting",
    category: "Board Meeting",
    meetingDate: "2026-07-21",
    durationMinutes: 60,
    status: "AWAITING_SIGNATURE",
    version: 6,
    deferredAt: null,
    deferredNote: null,
    humanOwned: false,
    failure: null,
    approval: {
      approvedByProfileId: "22222222-2222-4222-8222-222222222222",
      approvedByDisplayName: "Board Officer",
      approvedAt: "2026-07-21T11:00:00.000Z",
      contentVersion: 4,
      unresolvedVotesAcknowledged: false,
    },
    pdfArtifact: {
      id: "33333333-3333-4333-8333-333333333333",
      path: pdfPath,
      sha256: "a".repeat(64),
      sizeBytes: 1024,
      pageCount: 2,
      generatedAt: "2026-07-21T11:00:01.000Z",
      documentVersion: 4,
    },
    pdfAttempt: 1,
    updatedAt: "2026-07-21T11:00:02.000Z",
    tags: [],
    minutes: null,
    transcript: {
      id: "44444444-4444-4444-8444-444444444444",
      sourceTranscriptId: "read_ai:transcript-1",
      content: "Transcript evidence.",
      metadata: {},
      importedAt: "2026-07-21T10:00:00.000Z",
    },
    attendees: [],
    motions: [],
    history: [],
  };
}
