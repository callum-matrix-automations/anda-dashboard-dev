// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeetingPdfPreview } from "../../src/frontend/components/meetings/MeetingPdfPreview";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

const meetingId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("%PDF-1.7", {
    headers: { "content-type": "application/pdf" },
  })));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/approved-pdf");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("meeting PDF preview", () => {
  it("loads a compact preview and expands it into a full-screen dialog", async () => {
    const user = userEvent.setup();
    render(<MeetingPdfPreview meeting={meetingWithPdf()} />);

    await waitFor(() => expect(screen.getByTitle("Approved meeting minutes PDF").getAttribute("src"))
      .toContain("blob:http://localhost/approved-pdf"));
    expect(fetch).toHaveBeenCalledWith(`/api/meetings/${meetingId}/pdf/preview`, { cache: "no-store" });

    await user.click(screen.getByRole("button", { name: "Expand PDF preview" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTitle("Full-screen approved meeting minutes PDF")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Open PDF" }).getAttribute("href"))
      .toBe("blob:http://localhost/approved-pdf");
    await user.click(within(dialog).getByRole("button", { name: "Close PDF preview" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not request or render a preview before a PDF is associated", () => {
    render(<MeetingPdfPreview meeting={{ ...meetingWithPdf(), pdfArtifact: null }} />);
    expect(screen.queryByLabelText("Approved PDF preview")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the API explanation when the PDF cannot be loaded", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      error: { code: "pdf_preview_not_ready", message: "The approved PDF is not ready to preview." },
    }, { status: 409 }));
    render(<MeetingPdfPreview meeting={meetingWithPdf()} />);
    expect(await screen.findByText("The approved PDF is not ready to preview.")).toBeTruthy();
  });
});

function meetingWithPdf(): MeetingApiDetail {
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
      sizeBytes: 1024,
      pageCount: 2,
      generatedAt: "2026-07-21T11:00:01.000Z",
      documentVersion: 4,
    },
    pdfAttempt: 1,
    updatedAt: "2026-07-21T11:00:02.000Z",
    capabilities: {
      canEdit: false, canDefer: false, canResume: false, canMarkReady: false, canRetryAnalysis: false,
      canApprove: false, canRetryPdf: false, canOpenSigningSession: true, canRetrySigning: false,
      canRejectSigning: true, canRetrySigningOutcome: true, canDownloadArchive: false,
    },
    tags: [],
    minutes: null,
    transcript: {
      id: "44444444-4444-4444-8444-444444444444",
      sourceTranscriptId: "read_ai:transcript-1",
      content: "Transcript evidence.",
      importedAt: "2026-07-21T10:00:00.000Z",
    },
    source: {
      sourceMeetingId: "read_ai:meeting-1",
      startedAt: null,
      endedAt: null,
      durationMinutes: 60,
      importedAt: "2026-07-21T10:00:00.000Z",
    },
    sourceParticipants: [],
    attendeeOptions: [],
    attendees: [],
    motions: [],
    history: [],
  };
}
