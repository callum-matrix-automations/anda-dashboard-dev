// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingEditor } from "../../src/frontend/components/meetings/MeetingEditor";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

const officerId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";

afterEach(cleanup);

describe("MeetingEditor", () => {
  it("submits an atomic review draft containing edited minutes, attendance, motions, votes, and tags", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingEditor, { meeting: meeting(), save, cancel: vi.fn(), busy: false }));

    await user.clear(screen.getByLabelText("Minutes summary"));
    await user.type(screen.getByLabelText("Minutes summary"), "Updated board summary.");
    await user.click(screen.getByLabelText("General Member"));
    await user.click(screen.getByRole("button", { name: "Add motion" }));
    await user.type(screen.getByLabelText("Motion 1"), "Adopt the updated reserve plan.");
    await user.selectOptions(screen.getByLabelText("Moved by"), officerId);
    await user.selectOptions(screen.getByLabelText("Seconded by"), memberId);
    await user.selectOptions(screen.getByLabelText("General Member vote on motion 1"), "for");
    await user.type(screen.getByLabelText("Add tag"), "reserve");
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      minutes: expect.objectContaining({ summary: "Updated board summary." }),
      attendeeProfileIds: [officerId, memberId],
      tags: ["governance", "reserve"],
      motions: [expect.objectContaining({
        text: "Adopt the updated reserve plan.",
        moverProfileId: officerId,
        seconderProfileId: memberId,
        votes: [{ profileId: memberId, selection: "for" }],
      })],
    }));
    expect(screen.getByText(/transcript is read-only/i)).toBeTruthy();
  });

  it("shows validation feedback and does not save an invalid draft", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingEditor, { meeting: meeting(), save, cancel: vi.fn(), busy: false }));

    await user.clear(screen.getByLabelText("Minutes summary"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert").textContent).toMatch(/at least 1 character/i);
    expect(save).not.toHaveBeenCalled();
  });
});

function meeting(): MeetingApiDetail {
  return {
    id: "33333333-3333-4333-8333-333333333333",
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
      canRejectSigning: false, canRetrySigningOutcome: false, canDownloadArchive: false,
    },
    tags: ["governance"],
    minutes: { summary: "Original summary.", sections: [{ heading: "Opening", content: "The meeting opened." }] },
    transcript: {
      id: "44444444-4444-4444-8444-444444444444",
      sourceTranscriptId: "read_ai:transcript-1",
      content: "Full source transcript.",
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    source: {
      sourceMeetingId: "read_ai:meeting-1", startedAt: null, endedAt: null, durationMinutes: 60,
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    sourceParticipants: [],
    attendeeOptions: [
      { profileId: officerId, displayName: "Board Officer" },
      { profileId: memberId, displayName: "General Member" },
    ],
    attendees: [{ attendeeId: "55555555-5555-4555-8555-555555555555", profileId: officerId, displayName: "Board Officer" }],
    motions: [],
    history: [],
  };
}
