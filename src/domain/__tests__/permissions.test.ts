import { describe, expect, it } from "vitest";
import {
  canAccessMeetings,
  canAccessSection,
  canChangeMemberRole,
  canDeferMeeting,
  canEditMeeting,
  canManageAdminFlags,
  canManageMembers,
  canPerform,
  canResumeMeeting,
  canReviewMeetings,
  canTransferTreasurer,
  canViewSignatureQueue,
  hasAtLeastRole,
} from "../permissions";
import type { Viewer } from "../types";

const user: Viewer = { id: "u1", name: "Uma", role: "user", isAdmin: false, isSuperadmin: false };
const officer: Viewer = { id: "o1", name: "Omar", role: "officer", isAdmin: false, isSuperadmin: false };
const treasurer: Viewer = { id: "t1", name: "Tess", role: "treasurer", isAdmin: false, isSuperadmin: false };
const adminUser: Viewer = { id: "a1", name: "Ada", role: "user", isAdmin: true, isSuperadmin: false };
const superadmin: Viewer = { id: "s1", name: "Sam", role: "user", isAdmin: false, isSuperadmin: true };

describe("permissions", () => {
  it("role inheritance is treasurer >= officer >= user", () => {
    expect(hasAtLeastRole(treasurer, "officer")).toBe(true);
    expect(hasAtLeastRole(officer, "user")).toBe(true);
    expect(hasAtLeastRole(user, "officer")).toBe(false);
    expect(hasAtLeastRole(officer, "treasurer")).toBe(false);
  });

  it("meeting access follows the strict inherited hierarchy", () => {
    expect(canAccessMeetings(user)).toBe(true);
    expect(canReviewMeetings(user)).toBe(false);
    expect(canReviewMeetings(officer)).toBe(true);
    expect(canReviewMeetings(treasurer)).toBe(true);
    expect(canViewSignatureQueue(treasurer)).toBe(true);
    expect(canViewSignatureQueue(officer)).toBe(false);
  });

  it("superadmin is internal-only and has no meeting access", () => {
    expect(canAccessMeetings(superadmin)).toBe(false);
    expect(canReviewMeetings(superadmin)).toBe(false);
    expect(canViewSignatureQueue(superadmin)).toBe(false);
    expect(canEditMeeting(superadmin, { status: "PENDING_APPROVAL" })).toBe(false);
    expect(canPerform(superadmin, { status: "PENDING_APPROVAL", deferredAt: null }, "APPROVE")).toBe(false);
  });

  it("route access follows the diagram without privilege leakage", () => {
    expect(canAccessSection(user, "meetings")).toBe(true);
    expect(canAccessSection(user, "archive")).toBe(true);
    expect(canAccessSection(user, "financials")).toBe(false);
    expect(canAccessSection(user, "needs-review")).toBe(false);
    expect(canAccessSection(officer, "needs-review")).toBe(true);
    expect(canAccessSection(officer, "deferred")).toBe(true);
    expect(canAccessSection(officer, "signing")).toBe(false);
    expect(canAccessSection(treasurer, "signing")).toBe(true);
    expect(canAccessSection(adminUser, "members")).toBe(true);
    expect(canAccessSection(adminUser, "signing")).toBe(false);
    expect(canAccessSection(superadmin, "members")).toBe(true);
    expect(canAccessSection(superadmin, "dashboard")).toBe(false);
    expect(canAccessSection(superadmin, "archive")).toBe(false);
    expect(canAccessSection(superadmin, "financials")).toBe(false);
  });

  it("search and reports follow meeting access; settings is open to every level", () => {
    expect(canAccessSection(user, "search")).toBe(true);
    expect(canAccessSection(officer, "search")).toBe(true);
    expect(canAccessSection(superadmin, "search")).toBe(false);
    expect(canAccessSection(user, "reports")).toBe(true);
    expect(canAccessSection(superadmin, "reports")).toBe(false);
    // AIDEV-NOTE: Settings holds only personal profile/appearance state, so even the
    // internal Superadmin gets it without gaining any meeting data.
    expect(canAccessSection(user, "settings")).toBe(true);
    expect(canAccessSection(adminUser, "settings")).toBe(true);
    expect(canAccessSection(superadmin, "settings")).toBe(true);
  });

  it("only treasurer can sign or reject", () => {
    expect(canPerform(treasurer, { status: "AWAITING_SIGNATURE", deferredAt: null }, "SIGN")).toBe(true);
    expect(canPerform(officer, { status: "AWAITING_SIGNATURE", deferredAt: null }, "SIGN")).toBe(false);
    expect(canPerform(treasurer, { status: "AWAITING_SIGNATURE", deferredAt: null }, "REJECT")).toBe(true);
    expect(canPerform(officer, { status: "AWAITING_SIGNATURE", deferredAt: null }, "REJECT")).toBe(false);
  });

  it("account admin can manage accounts and only switch user/officer roles", () => {
    expect(canManageMembers(adminUser)).toBe(true);
    expect(canChangeMemberRole(adminUser, "user", "officer")).toBe(true);
    expect(canChangeMemberRole(adminUser, "officer", "user")).toBe(true);
    expect(canChangeMemberRole(adminUser, "user", "treasurer")).toBe(false);
    expect(canManageAdminFlags(adminUser)).toBe(false);
    expect(canTransferTreasurer(adminUser)).toBe(false);
  });

  it("superadmin alone controls admin flags and Treasurer transfer", () => {
    expect(canManageMembers(superadmin)).toBe(false);
    expect(canManageAdminFlags(superadmin)).toBe(true);
    expect(canTransferTreasurer(superadmin)).toBe(true);
  });

  it("admin flag does not grant lifecycle powers", () => {
    expect(canPerform(adminUser, { status: "AWAITING_SIGNATURE", deferredAt: null }, "SIGN")).toBe(false);
    expect(canPerform(adminUser, { status: "PENDING_APPROVAL", deferredAt: null }, "APPROVE")).toBe(false);
  });

  it("officer can approve pending meetings; user cannot", () => {
    expect(canPerform(officer, { status: "PENDING_APPROVAL", deferredAt: null }, "APPROVE")).toBe(true);
    expect(canPerform(officer, { status: "PENDING_APPROVAL", deferredAt: "2026-07-01" }, "APPROVE")).toBe(false);
    expect(canPerform(user, { status: "PENDING_APPROVAL", deferredAt: null }, "APPROVE")).toBe(false);
  });

  it("actions also require a legal transition", () => {
    expect(canPerform(treasurer, { status: "COMPLETED", deferredAt: null }, "SIGN")).toBe(false);
    expect(canPerform(officer, { status: "AWAITING_SIGNATURE", deferredAt: null }, "APPROVE")).toBe(false);
  });

  it("editing requires officer and an unlocked status", () => {
    expect(canEditMeeting(officer, { status: "PENDING_APPROVAL" })).toBe(true);
    expect(canEditMeeting(officer, { status: "PDF_PROCESSING" })).toBe(false);
    expect(canEditMeeting(user, { status: "PENDING_APPROVAL" })).toBe(false);
  });

  it("defer and resume require officer", () => {
    expect(canDeferMeeting(officer, { status: "PENDING_APPROVAL", deferredAt: null })).toBe(true);
    expect(canDeferMeeting(user, { status: "PENDING_APPROVAL", deferredAt: null })).toBe(false);
    expect(canResumeMeeting(officer, { status: "PENDING_APPROVAL", deferredAt: "2026-07-01" })).toBe(true);
    expect(canResumeMeeting(user, { status: "PENDING_APPROVAL", deferredAt: "2026-07-01" })).toBe(false);
    expect(canResumeMeeting(officer, { status: "COMPLETED", deferredAt: "2026-07-01" })).toBe(false);
  });
});
