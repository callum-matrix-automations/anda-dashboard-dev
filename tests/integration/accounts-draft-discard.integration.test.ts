import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { createRequestAuthClient, type AuthCookie } from "../../src/backend/auth/supabaseAuth";
import { createSupabaseServerActorResolver } from "../../src/backend/auth/serverActor";
import { localSupabaseConfiguration, loadPredefinedMeetingDraft, runPreApprovalWorkflow } from "./pre-approval-workflow.helpers";

const configuration=localSupabaseConfiguration();
const member="10000000-0000-4000-8000-000000000003";
const officer="10000000-0000-4000-8000-000000000001";
describe.skipIf(!configuration.configured)("accounts and draft discard in local Supabase", () => {
  it("allows member drafting, denies member approval/discard, version-checks officer discard and retains frozen evidence", async () => {
    const workflow=await runPreApprovalWorkflow({analyze:vi.fn().mockResolvedValue(await loadPredefinedMeetingDraft()),idPrefix:"ANDA-024-disposable-draft"});
    const meetingId=workflow.meetings[0]!.id;
    const repository=createSupabaseMeetingReviewRepository(configuration);
    const detail=await repository.getReview(meetingId);
    if (!detail) throw new Error("Missing local test draft");
    const identity={meetingId,expectedVersion:detail.version,actorProfileId:member};
    const approval=createSupabaseMeetingApprovalRepository(configuration);
    expect(await approval.approve({...identity,acknowledgeUnresolvedVotes:false})).toMatchObject({status:"invalid_actor"});
    expect(await repository.discardDraft(identity)).toMatchObject({status:"forbidden"});
    const deferred=await repository.deferReview({...identity,note:"Local role test"});
    expect(deferred.status).toBe("deferred");
    expect(await repository.discardDraft({...identity,actorProfileId:officer})).toMatchObject({status:"conflict"});
    const discarded=await repository.discardDraft({...identity,expectedVersion:deferred.version!,actorProfileId:officer});
    expect(discarded.status).toBe("discarded");
    expect(await repository.getReview(meetingId)).toBeNull();
    expect((await repository.listReviews()).some(item=>item.id===meetingId)).toBe(false);
    expect(await repository.resumeReview({...identity,expectedVersion:discarded.version!,actorProfileId:officer})).toMatchObject({status:"not_found"});
    expect(await repository.discardDraft({...identity,expectedVersion:discarded.version!,actorProfileId:officer})).toMatchObject({status:"not_found"});
    const admin=createClient(configuration.apiUrl!,configuration.secretKey!,{auth:{persistSession:false,autoRefreshToken:false}});
    expect((await admin.from("transcripts").select("id,content").eq("meeting_id",meetingId)).data).toHaveLength(1);
    expect((await admin.from("review_history").select("action,actor_profile_id").eq("meeting_id",meetingId)).data).toEqual(expect.arrayContaining([{action:"DISCARDED",actor_profile_id:officer}]));
    const mutation=await admin.from("meetings").update({discarded_at:null,discarded_by:null}).eq("id",meetingId);
    expect(mutation.error?.message).toContain("immutable");
    const lateEvidence=await admin.from("transcripts").update({metadata:{late:true}}).eq("meeting_id",meetingId);
    expect(lateEvidence.error?.message).toContain("immutable");
  },30000);
  it("uses actual member Auth and prevents direct profile/role escalation", async () => {
    const client=createClient(configuration.apiUrl!,process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const login=await client.auth.signInWithPassword({email:"james.wilson@example.com",password:"local-only-password"});
    expect(login.error).toBeNull(); expect(login.data.user?.id).toBe(member);
    const escalation=await client.from("profiles").update({member_role:"TREASURER"}).eq("id",member);
    expect(escalation.error).not.toBeNull();
    const rawDiscard=await client.rpc("discard_meeting_draft",{p_meeting_id:crypto.randomUUID(),p_expected_version:1,p_actor_profile_id:officer});
    expect(rawDiscard.error).not.toBeNull();
    await client.auth.signOut({scope:"local"});
  },15000);
  it("refreshes an expired cookie session and denies an inactive profile without ending its Auth session", async () => {
    const written: AuthCookie[]=[];
    const client=createRequestAuthClient(new Request("http://localhost:3000"),cookies=>written.push(...cookies));
    const result=await client.auth.signInWithPassword({email:"james.wilson@example.com",password:"local-only-password"});
    expect(result.error).toBeNull();
    const sessionCookies=written.filter(cookie=>cookie.value && cookie.name.includes("-auth-token"));
    const encoded=sessionCookies.sort((a,b)=>a.name.localeCompare(b.name)).map(cookie=>cookie.value).join("");
    expect(encoded.startsWith("base64-")).toBe(true);
    const session=JSON.parse(Buffer.from(encoded.slice(7),"base64url").toString("utf8"));
    session.expires_at=Math.floor(Date.now()/1000)-60;
    const expired="base64-"+Buffer.from(JSON.stringify(session)).toString("base64url");
    const cookieName=sessionCookies[0]!.name.replace(/\.\d+$/u,"");
    const refreshed: AuthCookie[]=[];
    const refreshedClient=createRequestAuthClient(new Request("http://localhost:3000",{headers:{cookie:`${cookieName}=${expired}`}}),cookies=>refreshed.push(...cookies));
    const user=await refreshedClient.auth.getUser();
    expect(user.error).toBeNull(); expect(user.data.user?.id).toBe(member);
    expect(refreshed.some(cookie=>cookie.value && cookie.options.httpOnly)).toBe(true);
    const admin=createClient(configuration.apiUrl!,configuration.secretKey!,{auth:{persistSession:false,autoRefreshToken:false}});
    try {
      const inactive=await admin.from("profiles").update({account_status:"DEACTIVATED"}).eq("id",member);
      expect(inactive.error).toBeNull();
      const resolve=createSupabaseServerActorResolver({verifyUser:async()=>user.data.user!.id,...configuration});
      expect(await resolve(new Request("http://localhost:3000"))).toBeNull();
    } finally {
      const restore=await admin.from("profiles").update({account_status:"ACTIVE"}).eq("id",member);
      expect(restore.error).toBeNull();
      await refreshedClient.auth.signOut({scope:"local"});
    }
  },15000);
});
