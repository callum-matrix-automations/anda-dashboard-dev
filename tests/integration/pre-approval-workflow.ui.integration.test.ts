import { describe, expect, it, vi } from "vitest";
import {
  loadPredefinedMeetingDraft,
  localSupabaseConfiguration,
  runPreApprovalWorkflow,
} from "./pre-approval-workflow.helpers";

const localIntegrationConfigured = localSupabaseConfiguration().configured;

describe.skipIf(!localIntegrationConfigured)("UI-ready pre-approval workflow", () => {
  it("creates one fully approvable PENDING_APPROVAL record for manual UI testing", async () => {
    const generatedDraft = await loadPredefinedMeetingDraft();
    const reviewedDraft = generatedDraft;

    const result = await runPreApprovalWorkflow({
      analyze: vi.fn().mockResolvedValue(reviewedDraft),
      idPrefix: "ui-review-workflow",
    });

    expect(result.responseStatus).toBe(202);
    expect(result.meetings).toEqual([expect.objectContaining({
      status: "PENDING_APPROVAL",
      minutes: reviewedDraft.minutes,
      human_owned: false,
    })]);
    expect(result.attendees).toHaveLength(5);
    expect(result.motions).toHaveLength(5);
    expect(result.motions.every((motion) => motion.outcome !== null)).toBe(true);
    expect(result.motions).toContainEqual(expect.objectContaining({ outcome: "NOT_SECONDED" }));
  }, 30_000);
});
