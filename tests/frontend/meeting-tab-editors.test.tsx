// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MeetingAttendanceEditor,
  MeetingMinutesEditor,
  MeetingMotionsEditor,
} from "../../src/frontend/components/meetings/MeetingTabEditors";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

const officerId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";

afterEach(cleanup);

describe("meeting tab editors", () => {
  it("edits minutes and tags while preserving the rest of the atomic draft", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingMinutesEditor, { meeting: meeting(), save, cancel: vi.fn(), busy: false }));

    await user.clear(screen.getByLabelText("Minutes summary"));
    await user.type(screen.getByLabelText("Minutes summary"), "Updated board summary.");
    await user.type(screen.getByLabelText("Add tag"), "reserve");
    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      minutes: expect.objectContaining({ summary: "Updated board summary." }),
      attendeeProfileIds: [officerId, memberId],
      tags: ["governance", "reserve"],
      motions: [expect.objectContaining({
        moverProfileId: officerId,
        seconderProfileId: memberId,
      })],
    }));
  });

  it("edits attendance and clears removed members from motion assignments", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingAttendanceEditor, { meeting: meeting(), save, cancel: vi.fn(), busy: false }));

    await user.click(screen.getByLabelText("General Member"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      attendeeProfileIds: [officerId],
      motions: [expect.objectContaining({
        moverProfileId: officerId,
        seconderProfileId: null,
        votes: [],
      })],
    }));
  });

  it("edits and saves a targeted motion from its local action row", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingMotionsEditor, {
      meeting: meeting({
        motions: [{
          ...meeting().motions[0]!,
          seconderProfileId: null,
          outcome: "unresolved",
        }],
      }),
      save,
      cancel: vi.fn(),
      busy: false,
      highlightedMotionIndexes: [0],
      focusMotionIndex: 0,
    }));

    expect(screen.getByText("Requires attention")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove motion" }).className).toContain("bg-destructive/10");
    await user.selectOptions(screen.getByLabelText("Seconded by"), memberId);
    await user.selectOptions(screen.getByLabelText("Outcome"), "carried");
    const saveButtons = screen.getAllByRole("button", { name: "Save changes" });
    expect(saveButtons).toHaveLength(2);
    await user.click(saveButtons[0]!);

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      motions: [expect.objectContaining({
        seconderProfileId: memberId,
        outcome: "carried",
      })],
    }));
  });

  it("shows validation feedback and does not save invalid minutes", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    render(createElement(MeetingMinutesEditor, { meeting: meeting(), save, cancel: vi.fn(), busy: false }));

    await user.clear(screen.getByLabelText("Minutes summary"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("alert").textContent).toMatch(/at least 1 character/i);
    expect(save).not.toHaveBeenCalled();
  });
});

function meeting(overrides: Partial<MeetingApiDetail> = {}): MeetingApiDetail {
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
      canRejectSigning: false, canCheckSigningStatus: false, canRetrySigningOutcome: false, canDownloadArchive: false,
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
      sourceMeetingId: "read_ai:meeting-1",
      startedAt: null,
      endedAt: null,
      durationMinutes: 60,
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    sourceParticipants: [],
    attendeeOptions: [
      { profileId: officerId, displayName: "Board Officer" },
      { profileId: memberId, displayName: "General Member" },
    ],
    attendees: [
      { attendeeId: "55555555-5555-4555-8555-555555555555", profileId: officerId, displayName: "Board Officer" },
      { attendeeId: "66666666-6666-4666-8666-666666666666", profileId: memberId, displayName: "General Member" },
    ],
    motions: [{
      motionId: "77777777-7777-4777-8777-777777777777",
      text: "Adopt the updated reserve plan.",
      moverProfileId: officerId,
      seconderProfileId: memberId,
      outcome: "carried",
      votes: [{
        voteId: "88888888-8888-4888-8888-888888888888",
        profileId: memberId,
        selection: "for",
      }],
    }],
    history: [],
    ...overrides,
  };
}
