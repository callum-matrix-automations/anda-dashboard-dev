import { describe, expect, it } from "vitest";
import {
  canDefer,
  canResume,
  canTransition,
  countUnresolvedVotes,
  isApprovalTransitionAllowed,
  isApprovalLocked,
  isEditingLocked,
  isImmutable,
  retryActionFor,
  requireRejectionComment,
  transition,
  transitionRejection,
} from "../stateMachine";
import { MEETING_STATUSES, type MeetingStatus } from "../types";

describe("meeting state machine", () => {
  it("defines exactly nine statuses", () => {
    expect(MEETING_STATUSES).toHaveLength(9);
  });

  it("walks the happy path AI_PROCESSING -> COMPLETED", () => {
    let s: MeetingStatus = "AI_PROCESSING";
    for (const action of ["AI_COMPLETE", "APPROVE", "PDF_COMPLETE", "SIGN"] as const) {
      const r = transition(s, action);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.status;
    }
    expect(s).toBe("COMPLETED");
  });

  it("rejects every action on COMPLETED (immutable)", () => {
    const r = transition("COMPLETED", "APPROVE");
    expect(r).toEqual({ ok: false, error: "Completed meetings are immutable." });
    expect(isImmutable("COMPLETED")).toBe(true);
  });

  it("locks editing from PDF_PROCESSING onward, open before approval", () => {
    expect(isEditingLocked("PENDING_APPROVAL")).toBe(false);
    expect(isEditingLocked("AI_FAILED")).toBe(false);
    for (const s of [
      "AI_PROCESSING",
      "PDF_PROCESSING",
      "PDF_FAILED",
      "AWAITING_SIGNATURE",
      "ESIGN_FAILED",
      "ARCHIVE_FAILED",
      "COMPLETED",
    ] as const) {
      expect(isEditingLocked(s)).toBe(true);
    }
  });

  it("distinguishes the approval lock from temporary analysis read-only state", () => {
    expect(isApprovalLocked("AI_PROCESSING")).toBe(false);
    expect(isApprovalLocked("PENDING_APPROVAL")).toBe(false);
    for (const status of ["PDF_PROCESSING", "PDF_FAILED", "AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED", "COMPLETED"] as const) {
      expect(isApprovalLocked(status)).toBe(true);
    }
  });

  it("REJECT bounces back to PENDING_APPROVAL from signature states only", () => {
    expect(transitionRejection("AWAITING_SIGNATURE", "  Correct the vote tally.  ")).toEqual({
      ok: true,
      status: "PENDING_APPROVAL",
      comment: "Correct the vote tally.",
    });
    expect(transitionRejection("ESIGN_FAILED", "Explain the source gap.")).toEqual({
      ok: true,
      status: "PENDING_APPROVAL",
      comment: "Explain the source gap.",
    });
    expect(transitionRejection("PENDING_APPROVAL", "Not allowed here.").ok).toBe(false);
    expect(transitionRejection("PDF_PROCESSING", "Not allowed here.").ok).toBe(false);
    expect(requireRejectionComment("  Correct the vote tally.  ")).toBe("Correct the vote tally.");
    expect(() => transitionRejection("AWAITING_SIGNATURE", "   ")).toThrow("comment");
  });

  it("AI_FAILED supports retry and manual-ready", () => {
    expect(transition("AI_FAILED", "AI_RETRY")).toEqual({ ok: true, status: "AI_PROCESSING" });
    expect(transition("AI_FAILED", "AI_MARK_MANUAL_READY")).toEqual({
      ok: true,
      status: "PENDING_APPROVAL",
    });
  });

  it("maps user-retryable failures to retry actions; archive recovery is automatic-only", () => {
    expect(retryActionFor("AI_FAILED")).toBe("AI_RETRY");
    expect(retryActionFor("PDF_FAILED")).toBe("PDF_RETRY");
    expect(retryActionFor("ESIGN_FAILED")).toBe("SIGN_RETRY");
    // Diagrams: archive recovery is automatic; there is no user retry control.
    expect(retryActionFor("ARCHIVE_FAILED")).toBeNull();
    expect(retryActionFor("COMPLETED")).toBeNull();
  });

  it("ARCHIVE_RETRY (system-driven) completes the meeting", () => {
    expect(transition("ARCHIVE_FAILED", "ARCHIVE_RETRY")).toEqual({
      ok: true,
      status: "COMPLETED",
    });
  });

  it("disallows transitions from wrong source states", () => {
    expect(canTransition("PENDING_APPROVAL", "SIGN")).toBe(false);
    expect(canTransition("AWAITING_SIGNATURE", "APPROVE")).toBe(false);
  });

  it("defer is orthogonal: only pre-approval, not already deferred", () => {
    expect(canDefer({ status: "PENDING_APPROVAL", deferredAt: null })).toBe(true);
    expect(canDefer({ status: "AI_FAILED", deferredAt: null })).toBe(true);
    expect(canDefer({ status: "PENDING_APPROVAL", deferredAt: "2026-07-01" })).toBe(false);
    expect(canDefer({ status: "AWAITING_SIGNATURE", deferredAt: null })).toBe(false);
    expect(canResume({ status: "PENDING_APPROVAL", deferredAt: "2026-07-01" })).toBe(true);
    expect(canResume({ status: "PENDING_APPROVAL", deferredAt: null })).toBe(false);
    expect(canResume({ status: "COMPLETED", deferredAt: "2026-07-01" })).toBe(false);
    expect(isApprovalTransitionAllowed({ status: "PENDING_APPROVAL", deferredAt: null })).toBe(true);
    expect(isApprovalTransitionAllowed({ status: "PENDING_APPROVAL", deferredAt: "2026-07-01" })).toBe(false);
  });

  it("counts unresolved votes across motions", () => {
    const motions = [
      {
        id: "m1",
        title: "t",
        movedBy: "a",
        secondedBy: null,
        outcome: "pending" as const,
        votes: [
          { memberId: "1", memberName: "A", result: "yes" as const },
          { memberId: "2", memberName: "B", result: "unresolved" as const },
        ],
      },
      {
        id: "m2",
        title: "t2",
        movedBy: "a",
        secondedBy: "b",
        outcome: "passed" as const,
        votes: [{ memberId: "3", memberName: "C", result: "unresolved" as const }],
      },
    ];
    expect(countUnresolvedVotes({ motions })).toBe(2);
    expect(countUnresolvedVotes({ motions: [] })).toBe(0);
  });
});
