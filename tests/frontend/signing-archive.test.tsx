// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddedFirmaSigning } from "../../src/frontend/components/signing/EmbeddedFirmaSigning";
import { MeetingSigningScreen } from "../../src/frontend/components/signing/MeetingSigningScreen";
import { ArchiveScreen } from "../../src/frontend/components/archive/ArchiveScreen";
import { ArchiveDetailScreen } from "../../src/frontend/components/archive/ArchiveDetailScreen";
import { TreasurerRejectionNotice } from "../../src/frontend/components/meetings/TreasurerRejectionNotice";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));

const meetingId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  routerPush.mockReset();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://localhost/approved-pdf");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("embedded Firma signing", () => {
  it("accepts lifecycle messages only from Firma's exact origin", () => {
    const started = vi.fn();
    const completed = vi.fn();
    render(<EmbeddedFirmaSigning
      signingUrl="https://app.firma.dev/signing/recipient-1"
      onStarted={started}
      onCompleted={completed}
      onDeclined={vi.fn()}
      onError={vi.fn()}
    />);

    window.dispatchEvent(new MessageEvent("message", { origin: "https://attacker.example", data: { type: "signing.completed" } }));
    expect(completed).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { origin: "https://app.firma.dev", data: { type: "signing.started" } }));
    window.dispatchEvent(new MessageEvent("message", { origin: "https://app.firma.dev", data: { type: "signing.completed" } }));
    expect(started).toHaveBeenCalledOnce();
    expect(completed).toHaveBeenCalledOnce();
  });
});

describe("Treasurer signing screen", () => {
  it("opens the server-provided signing session inside the dashboard", async () => {
    const user = userEvent.setup();
    const fetchMock = signingFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<MeetingSigningScreen meetingId={meetingId} />);

    await user.click(await screen.findByRole("button", { name: "Sign document" }));

    const iframe = await screen.findByTitle("Sign approved meeting minutes");
    expect(iframe.getAttribute("src")).toBe("https://app.firma.dev/signing/recipient-1");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/signing-session`,
      expect.any(Object),
    );
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://app.firma.dev",
      data: { type: "signing.completed" },
    }));
    expect(await screen.findByText(/waiting for the verified callback/i)).toBeTruthy();
  });

  it("requires a correction comment before returning a meeting to review", async () => {
    const user = userEvent.setup();
    const fetchMock = signingFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<MeetingSigningScreen meetingId={meetingId} />);

    await user.click(await screen.findByRole("button", { name: "Return for corrections" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Return for corrections" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/explain what must be corrected/i);

    await user.type(within(dialog).getByLabelText("Required correction comment"), "Correct the recorded vote count.");
    await user.click(within(dialog).getByRole("button", { name: "Return for corrections" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/signing/reject`,
      expect.objectContaining({ body: JSON.stringify({ expectedVersion: 6, comment: "Correct the recorded vote count." }) }),
    ));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/app/meetings/${meetingId}`));
  });

  it("shows the active Treasurer correction comment in the returned review", () => {
    render(<TreasurerRejectionNotice meeting={signingMeeting({
      status: "PENDING_APPROVAL",
      history: [{
        id: "88888888-8888-4888-8888-888888888888",
        actorProfileId: "22222222-2222-4222-8222-222222222222",
        actorDisplayName: "Priya Shah",
        action: "TREASURER_REJECTED",
        note: "Correct the recorded vote count.",
        createdAt: "2026-07-21T13:00:00.000Z",
      }],
    })} />);
    expect(screen.getByText("Correct the recorded vote count.")).toBeTruthy();
    expect(screen.getByText(/create a new document version/i)).toBeTruthy();
  });
});

describe("signed meeting archive screens", () => {
  it("sends topic, year, and category filters to the real archive API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(archiveListResponse()));
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<ArchiveScreen />);

    expect(await screen.findByText("ANDA Board Meeting")).toBeTruthy();
    await user.type(screen.getByLabelText("Topic search"), "budget");
    await user.type(screen.getByLabelText("Meeting year"), "2026");
    await user.selectOptions(screen.getByLabelText("Category"), "Board Meeting");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/archive?q=budget&year=2026&category=Board+Meeting&limit=10&offset=0",
      expect.any(Object),
    ));
  });

  it("renders immutable minutes and obtains temporary signed-PDF access", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/document")) return jsonResponse({
        meetingId,
        pdfId: "55555555-5555-4555-8555-555555555555",
        url: "https://supabase.example.test/storage/signed.pdf?token=temporary",
        expiresAt: "2026-07-21T14:05:00.000Z",
      });
      return jsonResponse(archiveDetail());
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<ArchiveDetailScreen meetingId={meetingId} />);

    expect(await screen.findByText("The board approved the reserve.")).toBeTruthy();
    expect(screen.getByText("Approve the reserve.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Get signed PDF" }));
    const open = await screen.findByRole("link", { name: "Open signed PDF" });
    expect(open.getAttribute("href")).toContain("token=temporary");
    expect(fetchMock).toHaveBeenCalledWith(`/api/archive/${meetingId}/document`, expect.any(Object));
  });
});

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function signingFetch() {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/pdf/preview")) return new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } });
    if (url.endsWith("/signing-session")) return jsonResponse({
      meetingId,
      documentVersion: 4,
      providerStatus: "pending",
      recipientEmail: "treasurer@example.test",
      signingUrl: "https://app.firma.dev/signing/recipient-1",
    });
    if (url.endsWith("/signing/reject") && init?.method === "POST") {
      return jsonResponse({ action: "signing_rejected", meetingId, version: 7, documentVersion: 4 });
    }
    return jsonResponse(signingMeeting());
  });
}

function signingMeeting(overrides: Partial<MeetingApiDetail> = {}): MeetingApiDetail {
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
    humanOwned: true,
    failure: null,
    approval: {
      approvedByProfileId: "22222222-2222-4222-8222-222222222222",
      approvedByDisplayName: "Eleanor Hughes",
      approvedAt: "2026-07-21T11:00:00.000Z",
      contentVersion: 4,
      unresolvedVotesAcknowledged: false,
    },
    pdfArtifact: {
      id: "33333333-3333-4333-8333-333333333333",
      sizeBytes: 12_000,
      pageCount: 3,
      generatedAt: "2026-07-21T11:00:01.000Z",
      documentVersion: 4,
    },
    pdfAttempt: 1,
    updatedAt: "2026-07-21T11:00:02.000Z",
    capabilities: {
      canEdit: false, canDefer: false, canResume: false, canMarkReady: false, canRetryAnalysis: false,
      canApprove: false, canRetryPdf: false, canOpenSigningSession: true, canRetrySigning: false,
      canRejectSigning: true, canCheckSigningStatus: true, canRetrySigningOutcome: false, canDownloadArchive: false,
    },
    tags: ["governance"],
    minutes: { summary: "Approved minutes.", sections: [{ heading: "Opening", content: "The meeting opened." }] },
    transcript: { id: "44444444-4444-4444-8444-444444444444", sourceTranscriptId: "read_ai:transcript-1", content: "Transcript.", importedAt: "2026-07-21T10:00:00.000Z" },
    source: { sourceMeetingId: "read_ai:meeting-1", startedAt: null, endedAt: null, durationMinutes: 60, importedAt: "2026-07-21T10:00:00.000Z" },
    sourceParticipants: [],
    attendeeOptions: [],
    attendees: [],
    motions: [],
    history: [],
    ...overrides,
  };
}

function archiveListResponse() {
  return { items: [archiveListItem()], total: 1, limit: 10, offset: 0 };
}

function archiveListItem() {
  return {
    meetingId,
    title: "ANDA Board Meeting",
    meetingDate: "2026-07-21",
    category: "Board Meeting",
    tags: ["budget"],
    signedBy: "22222222-2222-4222-8222-222222222222",
    signedAt: "2026-07-21T13:00:00.000Z",
    signedPdfId: "55555555-5555-4555-8555-555555555555",
    completedAt: "2026-07-21T13:01:00.000Z",
    version: 8,
  };
}

function archiveDetail() {
  return {
    ...archiveListItem(),
    minutes: { summary: "The board approved the reserve.", sections: [{ heading: "Budget", content: "The reserve was approved." }] },
    motions: [{ id: "66666666-6666-4666-8666-666666666666", text: "Approve the reserve.", outcome: "CARRIED" }],
    document: { pdfId: "55555555-5555-4555-8555-555555555555", sha256: "a".repeat(64), sizeBytes: 12_000, pageCount: 3, documentVersion: 4 },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
