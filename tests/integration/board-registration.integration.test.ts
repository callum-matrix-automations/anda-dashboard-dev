import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { registerBoardMember } from "../../src/backend/auth/registerBoardMember";
import { hasActiveAccountSession } from "../../src/backend/auth/activeSession";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { localSupabaseConfiguration, loadPredefinedMeetingDraft, runPreApprovalWorkflow } from "./pre-approval-workflow.helpers";
const config = localSupabaseConfiguration();
const ids = { president: "10000000-0000-4000-8000-000000000001", vice: "10000000-0000-4000-8000-000000000002", member: "10000000-0000-4000-8000-000000000003", treasurer: "10000000-0000-4000-8000-000000000006" };
function admin() { return createClient(config.apiUrl, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } }); }
function publicClient() { return createClient(config.apiUrl, process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); }
describe.skipIf(!config.configured)("ANDA-025 local registration and permissions", () => {
  it("self-registers only a USER, handles duplicate/concurrent signup and revokes sessions on operator reset", async () => {
    const client = admin(), user = publicClient();
    const input = { email: `anda-025-self-service-${randomUUID()}@example.test`, displayName: "Synthetic board member", password: "local-member-password" };
    let profileId: string | undefined;
    try {
      const results = await Promise.allSettled([registerBoardMember(input, client), registerBoardMember(input, client)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const profile = await client.from("profiles").select("id,member_role,board_position,is_admin,account_status").eq("email", input.email).single();
      expect(profile.error).toBeNull();
      profileId = profile.data!.id;
      expect(profile.data).toEqual({ id: profileId, member_role: "USER", board_position: null, is_admin: false, account_status: "ACTIVE" });
      await expect(registerBoardMember(input, client)).rejects.toThrow();
      expect((await user.auth.signInWithPassword({ email: input.email, password: input.password })).error).toBeNull();
      expect(await hasActiveAccountSession(user, profileId!)).toBe(true);
      expect((await user.from("board_invitations").select("*")).error).not.toBeNull();
      expect((await user.from("profiles").update({ member_role: "OFFICER", board_position: "PRESIDENT" }).eq("id", profileId!)).error).not.toBeNull();
      const oldSession = (await user.auth.getSession()).data.session!;
      const resetPassword = "local-reset-password";
      expect((await client.auth.admin.updateUserById(profileId!, { password: resetPassword })).error).toBeNull();
      expect((await client.rpc("revoke_board_account_sessions", { p_profile_id: profileId })).error).toBeNull();
      expect(await hasActiveAccountSession(user, profileId!)).toBe(false);
      const staleResponse = await fetch(`${config.apiUrl}/rest/v1/profiles?select=id&id=eq.${profileId}`, { headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${oldSession.access_token}`,
      } });
      expect(await staleResponse.json()).toEqual([]);
      expect((await user.auth.refreshSession({ refresh_token: oldSession.refresh_token })).error).not.toBeNull();
      expect((await user.auth.signInWithPassword({ email: input.email, password: input.password })).error).not.toBeNull();
      expect((await user.auth.signInWithPassword({ email: input.email, password: resetPassword })).error).toBeNull();
      expect(await hasActiveAccountSession(user, profileId!)).toBe(true);
    } finally {
      await user.auth.signOut();
      // Profiles are permanent historical identities: deactivate synthetic fixtures.
      if (profileId) {
        await client.from("profiles").update({ account_status: "DEACTIVATED" }).eq("id", profileId);
        await client.rpc("revoke_board_account_sessions", { p_profile_id: profileId });
      }
    }
  }, 30000);
  it("disables direct Auth signup independently of the app registration endpoint", async () => {
    const response = await publicClient().auth.signUp({ email: `anda-025-direct-${randomUUID()}@example.test`, password: "local-test-password" });
    expect(response.error?.code).toBe("signup_disabled");
    expect(response.data.user).toBeNull();
  });
  it("does not take over an existing Auth-only account or overwrite its password", async () => {
    const client = admin(), user = publicClient();
    const input = { email: `anda-025-existing-${randomUUID()}@example.test`, displayName: "Existing member", password: "replacement-password" };
    const created = await client.auth.admin.createUser({ email: input.email, password: "original-member-password", email_confirm: true });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    try {
      await expect(registerBoardMember(input, client)).rejects.toThrow();
      expect((await client.from("profiles").select("id").eq("id", id)).data).toHaveLength(0);
      expect((await user.auth.signInWithPassword({ email: input.email, password: input.password })).error).not.toBeNull();
      expect((await user.auth.signInWithPassword({ email: input.email, password: "original-member-password" })).error).toBeNull();
    } finally {
      await user.auth.signOut();
      await client.auth.admin.deleteUser(id);
    }
  }, 30000);
  it("enforces all draft mutations in SQL for each board position and allows eligible approvals", async () => {
    const workflow = await runPreApprovalWorkflow({ analyze: vi.fn().mockResolvedValue(await loadPredefinedMeetingDraft()), idPrefix: "ANDA-025-role-matrix" });
    const meetingId = workflow.meetings[0]!.id, reviews = createSupabaseMeetingReviewRepository(config), approvals = createSupabaseMeetingApprovalRepository(config);
    const meeting = (await reviews.getReview(meetingId))!;
    for (const actorProfileId of [ids.member, ids.vice, ids.treasurer]) {
      const identity = { meetingId, expectedVersion: meeting.version, actorProfileId };
      expect((await reviews.deferReview({ ...identity, note: "Denied draft change" })).status).toBe("forbidden");
      expect((await reviews.resumeReview(identity)).status).toBe("forbidden");
      expect((await reviews.markReady(identity)).status).toBe("forbidden");
      expect((await reviews.discardDraft(identity)).status).toBe("forbidden");
      expect((await reviews.saveDraft({ ...identity, draft: { minutes: meeting.minutes!, attendeeProfileIds: meeting.attendees.map(a => a.profileId), motions: meeting.motions, tags: [] } })).status).toBe("forbidden");
    }
    expect((await approvals.approve({ meetingId, expectedVersion: meeting.version, actorProfileId: ids.member, acknowledgeUnresolvedVotes: true })).status).toBe("invalid_actor");
    expect((await approvals.approve({ meetingId, expectedVersion: meeting.version, actorProfileId: ids.vice, acknowledgeUnresolvedVotes: true })).status).toBe("approved");
    expect((await reviews.deferReview({ meetingId, expectedVersion: meeting.version, actorProfileId: ids.president, note: "Locked after approval" })).status).not.toBe("deferred");
    for (const actorProfileId of [ids.president, ids.treasurer]) {
      const other = await runPreApprovalWorkflow({ analyze: vi.fn().mockResolvedValue(await loadPredefinedMeetingDraft()), idPrefix: "ANDA-025-eligible-approval" });
      const otherId = other.meetings[0]!.id, otherMeeting = (await reviews.getReview(otherId))!;
      expect((await approvals.approve({ meetingId: otherId, expectedVersion: otherMeeting.version, actorProfileId, acknowledgeUnresolvedVotes: true })).status).toBe("approved");
    }
  }, 30000);
});
