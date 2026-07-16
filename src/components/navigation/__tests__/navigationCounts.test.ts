import { describe, expect, it } from "vitest";
import { getNavigationTaskCounts } from "../navigationCounts";

describe("getNavigationTaskCounts", () => {
  it("counts active review and signing work while excluding deferred records", () => {
    const counts = getNavigationTaskCounts([
      { status: "AI_FAILED", deferredAt: null },
      { status: "PENDING_APPROVAL", deferredAt: null },
      { status: "PDF_FAILED", deferredAt: "2026-07-15T10:00:00.000Z" },
      { status: "AWAITING_SIGNATURE", deferredAt: null },
      { status: "ESIGN_FAILED", deferredAt: null },
      { status: "COMPLETED", deferredAt: null },
    ]);

    expect(counts).toEqual({ needsReview: 2, signing: 2 });
  });

  it("returns zero counts when no actionable records exist", () => {
    expect(getNavigationTaskCounts([
      { status: "COMPLETED", deferredAt: null },
    ])).toEqual({ needsReview: 0, signing: 0 });
  });
});
