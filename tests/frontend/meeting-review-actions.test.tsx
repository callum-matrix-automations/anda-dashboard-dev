// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingReviewActions } from "../../src/frontend/components/meetings/MeetingReviewActions";
import { MeetingWorkflowState } from "../../src/frontend/components/meetings/MeetingWorkflowState";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

const meetingId = "33333333-3333-4333-8333-333333333333";
const profileId = "11111111-1111-4111-8111-111111111111";
const seconderProfileId = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("meeting review workflow actions", () => {
  it("requires explicit unresolved-vote acknowledgement before approval", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "approved", meetingId, version: 5, documentVersion: 4, unresolvedVoteCount: 1,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const feedback = vi.fn();
    renderWithQuery(createElement(MeetingReviewActions, {
      meeting: reviewMeeting(), editing: false, onFeedback: feedback,
    }));

    expect(screen.queryByRole("button", { name: "Edit draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve minutes" }).className).toContain("!font-bold");
    await user.click(screen.getByRole("button", { name: "Approve minutes" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Approve minutes" }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/acknowledge/i);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Approve minutes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/approve`,
      expect.objectContaining({ body: JSON.stringify({ expectedVersion: 4, acknowledgeUnresolvedVotes: true }) }),
    ));
    await waitFor(() => expect(feedback).toHaveBeenCalledWith("Minutes approved. PDF generation has started.", "success"));
  });

  it("identifies the exact incomplete motion and blocks the API request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    const goToMotions = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const incomplete = reviewMeeting({
      motions: [{
        ...reviewMeeting().motions[0]!,
        text: "Allocate up to £2,000 for governance training.",
        seconderProfileId: null,
        outcome: "unresolved",
      }],
    });
    renderWithQuery(createElement(MeetingReviewActions, {
      meeting: incomplete, editing: false, onGoToMotions: goToMotions, onFeedback: vi.fn(),
    }));

    await user.click(screen.getByRole("button", { name: "Approve minutes" }));
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByRole("alert").textContent).toContain("Allocate up to £2,000 for governance training");
    expect(within(dialog).getByRole("alert").textContent).toContain("needs a seconder");
    expect(within(dialog).getByRole("alert").textContent).toContain("needs a final outcome");
    expect((within(dialog).getByRole("button", { name: "Approve minutes" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Go to motions" }));
    expect(goToMotions).toHaveBeenCalledWith([0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a motion explicitly marked not seconded to proceed without a seconder", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ action: "approved", meetingId, version: 5 }));
    vi.stubGlobal("fetch", fetchMock);
    const meeting = reviewMeeting({
      motions: [{
        ...reviewMeeting().motions[0]!,
        text: "Allocate up to £2,000 for governance training.",
        seconderProfileId: null,
        outcome: "not_seconded",
        votes: [],
      }],
    });
    renderWithQuery(createElement(MeetingReviewActions, {
      meeting, editing: false, onFeedback: vi.fn(),
    }));

    await user.click(screen.getByRole("button", { name: "Approve minutes" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/needs a seconder/i)).toBeNull();
    expect((within(dialog).getByRole("button", { name: "Approve minutes" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("retries failed PDF generation through the versioned endpoint", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "pdf_retry_started", meetingId, version: 5, documentVersion: 4,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const feedback = vi.fn();
    const meeting = reviewMeeting({
      status: "PDF_FAILED",
      capabilities: { ...reviewMeeting().capabilities, canEdit: false, canDefer: false, canApprove: false, canRetryPdf: true },
      failure: { code: "pdf_failed", message: "Renderer unavailable.", at: "2026-07-21T10:00:00.000Z" },
    });
    renderWithQuery(createElement(MeetingWorkflowState, { meeting, onFeedback: feedback }));

    await user.click(screen.getByRole("button", { name: "Retry PDF generation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/pdf/retry`,
      expect.objectContaining({ body: JSON.stringify({ expectedVersion: 4 }) }),
    ));
    await waitFor(() => expect(feedback).toHaveBeenCalledWith("PDF generation restarted.", "success"));
  });

  it("checks the live Firma state while a signing request is active", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "signing_status_checked", meetingId, version: 4, attempt: 2,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const feedback = vi.fn();
    const meeting = reviewMeeting({
      status: "AWAITING_SIGNATURE",
      capabilities: {
        ...reviewMeeting().capabilities,
        canEdit: false,
        canDefer: false,
        canApprove: false,
        canOpenSigningSession: true,
        canRejectSigning: true,
        canCheckSigningStatus: true,
      },
    });
    renderWithQuery(createElement(MeetingWorkflowState, { meeting, onFeedback: feedback }));

    await user.click(screen.getByRole("button", { name: "Check signing status" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/signing-status/check`,
      expect.objectContaining({ body: JSON.stringify({ expectedVersion: 4 }) }),
    ));
    await waitFor(() => expect(feedback).toHaveBeenCalledWith("Firma signing status checked.", "success"));
  });

  it("offers delivery retry and failed-completion recovery for e-signature failures", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "signing_outcome_retry_started", meetingId, version: 5, documentVersion: 4,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const feedback = vi.fn();
    const meeting = reviewMeeting({
      status: "ESIGN_FAILED",
      capabilities: {
        ...reviewMeeting().capabilities,
        canEdit: false,
        canDefer: false,
        canApprove: false,
        canRetrySigning: true,
        canRetrySigningOutcome: true,
      },
      failure: { code: "esign_failed", message: "Firma callback was missed.", at: "2026-07-21T10:00:00.000Z" },
    });
    renderWithQuery(createElement(MeetingWorkflowState, { meeting, onFeedback: feedback }));

    expect(screen.getByRole("button", { name: "Retry signing delivery" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry completion check" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/signing-outcome/retry`,
      expect.objectContaining({ body: JSON.stringify({ expectedVersion: 4 }) }),
    ));
  });

  it("keeps archive failures locked without exposing a manual retry", () => {
    const meeting = reviewMeeting({
      status: "ARCHIVE_FAILED",
      capabilities: {
        ...reviewMeeting().capabilities,
        canEdit: false,
        canDefer: false,
        canApprove: false,
        canRetrySigning: false,
        canRetrySigningOutcome: false,
      },
      failure: { code: "archive_failed", message: "Storage is temporarily unavailable.", at: "2026-07-21T10:00:00.000Z" },
    });
    renderWithQuery(createElement(MeetingWorkflowState, { meeting, onFeedback: vi.fn() }));
    expect(screen.getByText(/automatic recovery will continue/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

function renderWithQuery(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}

function reviewMeeting(overrides: Partial<MeetingApiDetail> = {}): MeetingApiDetail {
  return {
    id: meetingId,
    sourceMeetingId: "read_ai:meeting-1",
    title: "ANDA Board Meeting",
    category: "Board Meeting",
    meetingDate: "2026-07-21",
    durationMinutes: 60,
    status: "PENDING_APPROVAL",
    version: 4,
    deferredAt: null,
    deferredNote: null,
    humanOwned: false,
    failure: null,
    approval: null,
    pdfArtifact: null,
    pdfAttempt: 0,
    updatedAt: "2026-07-21T10:00:00.000Z",
    capabilities: {
      canEdit: true, canDefer: true, canResume: false, canMarkReady: false, canRetryAnalysis: false,
      canApprove: true, canRetryPdf: false, canOpenSigningSession: false, canRetrySigning: false,
      canRejectSigning: false, canCheckSigningStatus: false, canRetrySigningOutcome: false, canDownloadArchive: false,
    },
    tags: [],
    minutes: { summary: "Summary.", sections: [{ heading: "Opening", content: "Opened." }] },
    transcript: {
      id: "44444444-4444-4444-8444-444444444444", sourceTranscriptId: "read_ai:transcript-1",
      content: "Transcript.", importedAt: "2026-07-21T09:00:00.000Z",
    },
    source: {
      sourceMeetingId: "read_ai:meeting-1", startedAt: null, endedAt: null, durationMinutes: 60,
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    sourceParticipants: [],
    attendeeOptions: [
      { profileId, displayName: "Board Officer" },
      { profileId: seconderProfileId, displayName: "General Member" },
    ],
    attendees: [
      { attendeeId: "55555555-5555-4555-8555-555555555555", profileId, displayName: "Board Officer" },
      { attendeeId: "88888888-8888-4888-8888-888888888888", profileId: seconderProfileId, displayName: "General Member" },
    ],
    motions: [{
      motionId: "66666666-6666-4666-8666-666666666666", text: "Approve plan.", moverProfileId: profileId,
      seconderProfileId, outcome: "carried",
      votes: [{ voteId: "77777777-7777-4777-8777-777777777777", profileId, selection: "unresolved" }],
    }],
    history: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
