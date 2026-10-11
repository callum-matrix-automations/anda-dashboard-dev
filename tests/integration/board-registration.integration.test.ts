import { createHash, randomBytes, randomUUID } from "node:crypto";
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
async function invite(client: ReturnType<typeof admin>, extra = {}) {
  const code = randomBytes(32).toString("base64url"), email = `anda-025-${randomUUID()}@example.test`;
  const token_hash = createHash("sha256").update(code).digest("hex");
  const inserted = await client.from("board_invitations").insert({ email, token_hash, expires_at: new Date(Date.now() + 3600_000).toISOString(), ...extra }).select("id,registration_profile_id").single();
  if (inserted.error) throw inserted.error;
  return { code, email, token_hash, ...inserted.data };
}
describe.skipIf(!config.configured)("ANDA-025 local registration and permissions", () => {
  it("activates only an invitation-bound USER, handles concurrency/replay and revokes sessions on operator reset", async () => {
    const client = admin(), invitation = await invite(client), user = publicClient();
    const input = { email: invitation.email, invitationCode: invitation.code, displayName: "Synthetic board member", password: "local-member-password" };
    try {
      await expect(registerBoardMember({ ...input, email: "outsider@example.test" }, client)).rejects.toThrow();
      const results = await Promise.allSettled([registerBoardMember(input, client), registerBoardMember(input, client)]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const profile = await client.from("profiles").select("member_role,board_position,is_admin,account_status").eq("id", invitation.registration_profile_id).single();
      expect(profile.data).toEqual({ member_role: "USER", board_position: null, is_admin: false, account_status: "ACTIVE" });
      await expect(registerBoardMember(input, client)).rejects.toThrow();
      expect((await user.auth.signInWithPassword({ email: invitation.email, password: input.password })).error).toBeNull();
      expect(await hasActiveAccountSession(user, invitation.registration_profile_id)).toBe(true);
      expect((await user.from("board_invitations").select("*")).error).not.toBeNull();
      expect((await user.rpc("claim_board_invitation", { p_token_hash: invitation.token_hash, p_email: invitation.email, p_lease_id: randomUUID() })).error).not.toBeNull();
      expect((await user.from("profiles").update({ member_role: "OFFICER", board_position: "PRESIDENT" }).eq("id", invitation.registration_profile_id)).error).not.toBeNull();
      const oldSession = (await user.auth.getSession()).data.session!;
      const resetPassword = "local-reset-password";
      expect((await client.auth.admin.updateUserById(invitation.registration_profile_id, { password: resetPassword })).error).toBeNull();
      expect((await client.rpc("revoke_board_account_sessions", { p_profile_id: invitation.registration_profile_id })).error).toBeNull();
      expect(await hasActiveAccountSession(user, invitation.registration_profile_id)).toBe(false);
      const staleResponse = await fetch(`${config.apiUrl}/rest/v1/profiles?select=id&id=eq.${invitation.registration_profile_id}`, { headers: {
        apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, authorization: `Bearer ${oldSession.access_token}`,
      } });
      expect(await staleResponse.json()).toEqual([]);
      expect((await user.auth.refreshSession({ refresh_token: oldSession.refresh_token })).error).not.toBeNull();
      expect((await user.auth.signInWithPassword({ email: invitation.email, password: input.password })).error).not.toBeNull();
      expect((await user.auth.signInWithPassword({ email: invitation.email, password: resetPassword })).error).toBeNull();
      expect(await hasActiveAccountSession(user, invitation.registration_profile_id)).toBe(true);
    } finally {
      await user.auth.signOut();
      await client.from("profiles").delete().eq("id", invitation.registration_profile_id);
      await client.auth.admin.deleteUser(invitation.registration_profile_id);
      await client.from("board_invitations").delete().eq("id", invitation.id);
    }
  }, 30000);
  it("disables direct Auth signup independently of the app registration endpoint", async () => {
    const response = await publicClient().auth.signUp({ email: `anda-025-direct-${randomUUID()}@example.test`, password: "local-test-password" });
    expect(response.error?.code).toBe("signup_disabled");
    expect(response.data.user).toBeNull();
  });
  it("safely recovers an Auth-only incomplete activation and denies expired/revoked invitations", async () => {
    const client = admin(), invitation = await invite(client);
    const input = { email: invitation.email, invitationCode: invitation.code, displayName: "Recovery member", password: "local-recovered-password" };
    try {
      expect((await client.auth.admin.createUser({ id: invitation.registration_profile_id, email: invitation.email, password: "old-incomplete-password", email_confirm: true })).error).toBeNull();
      expect(await registerBoardMember(input, client)).toEqual({ ok: true });
      expect((await client.from("profiles").select("id").eq("id", invitation.registration_profile_id)).data).toHaveLength(1);
      for (const extra of [{ expires_at: new Date(0).toISOString() }, { revoked_at: new Date().toISOString() }]) {
        const denied = await invite(client, extra);
        await expect(registerBoardMember({ ...input, email: denied.email, invitationCode: denied.code }, client)).rejects.toThrow();
        expect((await client.auth.admin.getUserById(denied.registration_profile_id)).data.user).toBeNull();
        await client.from("board_invitations").delete().eq("id", denied.id);
      }
    } finally {
      await client.from("profiles").delete().eq("id", invitation.registration_profile_id);
      await client.auth.admin.deleteUser(invitation.registration_profile_id);
      await client.from("board_invitations").delete().eq("id", invitation.id);
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
