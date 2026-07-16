import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/domain/types";
import { ReviewSummary } from "../ReviewSummary";

const meeting: Meeting = {
  id: "mtg-1",
  title: "June Board Meeting",
  category: "Board Meeting",
  date: "2026-06-30",
  status: "PENDING_APPROVAL",
  version: 3,
  deferredAt: null,
  deferredNote: null,
  failureReason: null,
  rejection: null,
  signedBy: null,
  signedAt: null,
  humanOwned: false,
  source: {
    provider: "Microsoft Teams",
    reference: "teams:19:meeting_x@thread.v2",
    importedAt: "2026-06-30T21:05:00Z",
    importStatus: "imported",
    participants: [
      { id: "p1", displayName: "Priya Raman", matched: true, memberId: "mem-01", memberName: "Priya Raman" },
      { id: "p2", displayName: "Guest", matched: false, reason: "Not a member." },
    ],
  },
  analysisAttempt: 1,
  tags: ["Pool"],
  pdfArtifact: null,
  archivedAt: null,
  history: [],
  minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }],
  attendees: [
    { memberId: "m1", name: "Priya Raman", role: "Treasurer", present: true },
    { memberId: "m2", name: "Grace Lindqvist", role: "Member", present: false },
  ],
  motions: [
    {
      id: "mot-1",
      title: "Award contract",
      movedBy: "Priya Raman",
      secondedBy: null,
      outcome: "passed",
      votes: [
        { memberId: "m1", memberName: "Priya Raman", result: "yes" },
        { memberId: "m2", memberName: "Grace Lindqvist", result: "unresolved" },
      ],
    },
  ],
  transcript: "transcript text",
};

const noop = { onOpenTab: () => {}, canEditTags: false, tagsBusy: false, onAddTag: () => {}, onRemoveTag: () => {} };

describe("ReviewSummary", () => {
  it("summarizes source import and participant matching", () => {
    render(<ReviewSummary meeting={meeting} {...noop} />);
    expect(screen.getByText(/Microsoft Teams/)).toBeInTheDocument();
    expect(screen.getByText(/1 matched/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 unmatched/).length).toBeGreaterThanOrEqual(1);
  });

  it("reports ownership, completeness, and unresolved votes", () => {
    render(<ReviewSummary meeting={meeting} {...noop} />);
    expect(screen.getByText(/Fixture analysis draft/i)).toBeInTheDocument();
    expect(screen.getByText(/No AI service ran/i)).toBeInTheDocument();
    expect(screen.getByText(/1 minutes section/)).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 present/)).toBeInTheDocument();
    expect(screen.getByText(/1 motion/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 unresolved vote/).length).toBeGreaterThanOrEqual(1);
  });

  it("reports the human-owned state after an officer edit", () => {
    render(<ReviewSummary meeting={{ ...meeting, humanOwned: true }} {...noop} />);
    expect(screen.getByText(/Human-owned draft/i)).toBeInTheDocument();
  });

  it("makes a treasurer rejection prominent", () => {
    render(
      <ReviewSummary
        meeting={{ ...meeting, rejection: { by: "Priya Raman", comment: "Fix the vote tally.", at: "2026-07-01T09:00:00Z" } }}
        {...noop}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Priya Raman");
    expect(alert).toHaveTextContent("Fix the vote tally.");
  });

  it("leads with readiness, explains non-blocking unresolved votes, and makes issues jump actions", async () => {
    const onOpenTab = vi.fn();
    render(<ReviewSummary meeting={meeting} {...noop} onOpenTab={onOpenTab} />);
    expect(screen.getByRole("heading", { name: "Ready to approve" })).toBeInTheDocument();
    expect(screen.getByText(/advances its local status to PDF processing; no PDF service runs/i)).toBeInTheDocument();
    expect(screen.getByText(/does not block approval/i)).toBeInTheDocument();
    expect(screen.getByText(/unmatched speakers are advisory.*do not block approval/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review 1 unresolved vote" }));
    expect(onOpenTab).toHaveBeenCalledWith("Motions");
    await userEvent.click(screen.getByRole("button", { name: "Review 1 unmatched speaker" }));
    expect(onOpenTab).toHaveBeenCalledWith("Transcript");
  });

  it("uses the shared draft-completeness policy for structurally incomplete content", async () => {
    const onOpenTab = vi.fn();
    render(
      <ReviewSummary
        meeting={{ ...meeting, minutes: [{ ...meeting.minutes[0]!, body: "" }] }}
        {...noop}
        onOpenTab={onOpenTab}
      />,
    );

    expect(screen.getByRole("heading", { name: "Needs attention" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review 1 minutes issue" }));
    expect(onOpenTab).toHaveBeenCalledWith("Minutes");
  });

  it("distinguishes complete deferred content from a record ready for approval", () => {
    render(
      <ReviewSummary
        meeting={{ ...meeting, deferredAt: "2026-07-01T09:00:00Z", deferredNote: "Awaiting clarification." }}
        {...noop}
      />,
    );

    expect(screen.getByRole("heading", { name: "Ready after resume" })).toBeInTheDocument();
    expect(screen.getByText(/Resume the deferred record before approval/i)).toBeInTheDocument();
  });

  it("does not describe temporary analysis state as completed approval", () => {
    render(<ReviewSummary meeting={{ ...meeting, status: "AI_PROCESSING" }} {...noop} />);
    expect(screen.getByRole("heading", { name: "Demo analysis in progress" })).toBeInTheDocument();
    expect(screen.getByText(/No AI service is running/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Approval complete" })).not.toBeInTheDocument();
  });

  it("labels fixture source gaps as advisory rather than implying live ingestion", () => {
    render(
      <ReviewSummary
        meeting={{ ...meeting, source: { ...meeting.source, importStatus: "imported_with_gaps" } }}
        {...noop}
      />,
    );

    expect(screen.getByText(/Fixture source recorded from Microsoft Teams/i)).toBeInTheDocument();
    expect(screen.getByText(/source import gaps are advisory.*do not block approval/i)).toBeInTheDocument();
  });

  it("shows lifecycle failure detail when analysis has failed", () => {
    render(
      <ReviewSummary
        meeting={{ ...meeting, status: "AI_FAILED", failureReason: "Upstream timeout.", minutes: [] }}
        {...noop}
      />,
    );
    expect(screen.getByText("Upstream timeout.")).toBeInTheDocument();
    expect(screen.getByText(/Not ready/i)).toBeInTheDocument();
  });
});
