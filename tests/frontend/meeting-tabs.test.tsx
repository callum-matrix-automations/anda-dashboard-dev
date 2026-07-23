// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../src/frontend/components/design-system/primitives/tooltip";
import { MeetingTabs } from "../../src/frontend/components/meetings/MeetingTabs";
import type { MeetingApiDetail } from "../../src/shared/contracts/meetingApi";

afterEach(cleanup);

describe("MeetingTabs motions", () => {
  it("uses semantic pills for motion outcomes and attendee votes", () => {
    render(<MeetingTabs meeting={meeting} tab="Motions" />);

    expect(screen.getByText("Carried").className).toContain("bg-success/15");
    expect(screen.getByText("Failed").className).toContain("bg-destructive/10");
    expect(screen.getByText("Unresolved").className).toContain("bg-warning/15");
    expect(screen.getByText("Alex Morgan: for").className).toContain("bg-success/15");
    expect(screen.getByText("Bailey Shaw: against").className).toContain("bg-destructive/10");
    expect(screen.getByText("Casey Brown: abstain").className).toContain("bg-input/20");
  });

  it("marks targeted motion cards, explains their issues, and opens their editor", async () => {
    const user = userEvent.setup();
    const onEditMotion = vi.fn();
    render(
      <TooltipProvider>
        <MeetingTabs
          meeting={meeting}
          tab="Motions"
          highlightedMotionIndexes={[1]}
          motionIssues={[{ motionIndex: 1, messages: ["Motion 2 needs a seconder."] }]}
          onEditMotion={onEditMotion}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Requires attention before approval")).toBeTruthy();
    expect(screen.getByText("Failed motion").closest("article[data-needs-attention]")).toBeTruthy();
    await user.hover(screen.getByLabelText("View issues for motion 2"));
    expect(await screen.findByText("Motion 2 needs a seconder.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit now" }));
    expect(onEditMotion).toHaveBeenCalledWith(1);
  });
});

const alexId = "11111111-1111-4111-8111-111111111111";
const baileyId = "22222222-2222-4222-8222-222222222222";
const caseyId = "33333333-3333-4333-8333-333333333333";

const meeting: MeetingApiDetail = {
  id: "44444444-4444-4444-8444-444444444444",
  sourceMeetingId: "read_ai:meeting-1",
  title: "Committee meeting",
  category: "Committee Meeting",
  meetingDate: "2026-07-23",
  durationMinutes: 60,
  status: "PENDING_APPROVAL",
  version: 1,
  deferredAt: null,
  deferredNote: null,
  humanOwned: false,
  failure: null,
  approval: null,
  pdfArtifact: null,
  pdfAttempt: 0,
  updatedAt: "2026-07-23T10:00:00.000Z",
  capabilities: {
    canEdit: true, canDefer: true, canResume: false, canMarkReady: false, canRetryAnalysis: false,
    canApprove: true, canRetryPdf: false, canOpenSigningSession: false, canRetrySigning: false,
    canRejectSigning: false, canCheckSigningStatus: false, canRetrySigningOutcome: false, canDownloadArchive: false,
  },
  tags: [],
  minutes: null,
  transcript: {
    id: "55555555-5555-4555-8555-555555555555",
    sourceTranscriptId: "read_ai:transcript-1",
    content: "Transcript.",
    importedAt: "2026-07-23T09:00:00.000Z",
  },
  source: {
    sourceMeetingId: "read_ai:meeting-1",
    startedAt: null,
    endedAt: null,
    durationMinutes: 60,
    importedAt: "2026-07-23T09:00:00.000Z",
  },
  sourceParticipants: [],
  attendeeOptions: [
    { profileId: alexId, displayName: "Alex Morgan" },
    { profileId: baileyId, displayName: "Bailey Shaw" },
    { profileId: caseyId, displayName: "Casey Brown" },
  ],
  attendees: [
    { attendeeId: "66666666-6666-4666-8666-666666666666", profileId: alexId, displayName: "Alex Morgan" },
    { attendeeId: "77777777-7777-4777-8777-777777777777", profileId: baileyId, displayName: "Bailey Shaw" },
    { attendeeId: "88888888-8888-4888-8888-888888888888", profileId: caseyId, displayName: "Casey Brown" },
  ],
  motions: [
    { motionId: "99999999-9999-4999-8999-999999999999", text: "Carried motion", moverProfileId: alexId, seconderProfileId: baileyId, outcome: "carried", votes: [{ voteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", profileId: alexId, selection: "for" }] },
    { motionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", text: "Failed motion", moverProfileId: alexId, seconderProfileId: baileyId, outcome: "failed", votes: [{ voteId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", profileId: baileyId, selection: "against" }] },
    { motionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", text: "Unresolved motion", moverProfileId: alexId, seconderProfileId: baileyId, outcome: "unresolved", votes: [{ voteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", profileId: caseyId, selection: "abstain" }] },
  ],
  history: [],
};
