import { describe, expect, it } from "vitest";
import type { Viewer } from "../types";
import { canEditTags } from "../permissions";
import { addTag, removeTag } from "../tags";

const officer: Viewer = { id: "o", name: "Daniel Okafor", role: "officer", isAdmin: false, isSuperadmin: false };
const user: Viewer = { id: "u", name: "Grace Lindqvist", role: "user", isAdmin: false, isSuperadmin: false };
const superadmin: Viewer = { id: "s", name: "Internal", role: "user", isAdmin: false, isSuperadmin: true };

describe("manual meeting tags", () => {
  it("lets officers edit tags only before approval", () => {
    expect(canEditTags(officer, { status: "PENDING_APPROVAL" })).toBe(true);
    expect(canEditTags(officer, { status: "AI_FAILED" })).toBe(true);
    for (const status of ["PDF_PROCESSING", "PDF_FAILED", "AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED", "COMPLETED"] as const) {
      expect(canEditTags(officer, { status })).toBe(false);
    }
  });

  it("denies plain users and superadmin regardless of status", () => {
    expect(canEditTags(user, { status: "PENDING_APPROVAL" })).toBe(false);
    expect(canEditTags(superadmin, { status: "PENDING_APPROVAL" })).toBe(false);
  });

  it("adds trimmed tags and ignores case-insensitive duplicates", () => {
    expect(addTag([], "  Budget ")).toEqual(["Budget"]);
    expect(addTag(["Budget"], "budget")).toEqual(["Budget"]);
    expect(addTag(["Budget"], "Reserve Study")).toEqual(["Budget", "Reserve Study"]);
  });

  it("rejects blank tags unchanged", () => {
    expect(addTag(["Budget"], "   ")).toEqual(["Budget"]);
  });

  it("removes a tag without mutating the source list", () => {
    const tags = ["Budget", "Pool"];
    expect(removeTag(tags, "Budget")).toEqual(["Pool"]);
    expect(tags).toEqual(["Budget", "Pool"]);
  });
});
