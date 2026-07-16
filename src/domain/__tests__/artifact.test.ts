import { describe, expect, it } from "vitest";
import { MEETING_STATUSES } from "../types";
import { artifactStateFor, type ArtifactState } from "../artifact";

describe("PDF artifact state mapping", () => {
  it.each([
    ["AI_PROCESSING", "not_generated"],
    ["AI_FAILED", "not_generated"],
    ["PENDING_APPROVAL", "not_generated"],
    ["PDF_PROCESSING", "processing"],
    ["PDF_FAILED", "failed"],
    ["AWAITING_SIGNATURE", "unsigned_ready"],
    ["ESIGN_FAILED", "unsigned_ready"],
    ["ARCHIVE_FAILED", "signed"],
    ["COMPLETED", "signed"],
  ] as const)("maps %s to %s", (status, expected: ArtifactState) => {
    expect(artifactStateFor(status)).toBe(expected);
  });

  it("covers every lifecycle status", () => {
    for (const status of MEETING_STATUSES) {
      expect(() => artifactStateFor(status)).not.toThrow();
    }
  });
});
