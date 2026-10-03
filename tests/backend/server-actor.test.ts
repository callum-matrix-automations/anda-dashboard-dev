import { describe, expect, it, vi } from "vitest";
import { actorHasPermission, createSupabaseServerActorResolver, ServerActorResolutionError } from "../../src/backend/auth/serverActor";
const profileId="11111111-1111-4111-8111-111111111111";
describe("verified account identity", () => {
  it("selects only the server-verified user, ignoring client profile and role claims", async () => {
    const fetchImplementation=vi.fn().mockResolvedValue(Response.json([{id:profileId,account_type:"MEMBER",member_role:"USER",display_name:"Member",account_status:"ACTIVE"}]));
    const resolver=createSupabaseServerActorResolver({verifyUser:async()=>profileId,apiUrl:"https://project.supabase.co",secretKey:"sb_secret_hosted",fetchImplementation});
    expect(await resolver(new Request("https://anda.test/api/meetings",{headers:{"x-actor-profile-id":"attacker","x-role":"TREASURER"}}))).toEqual({profileId,displayName:"Member",role:"USER"});
    expect((fetchImplementation.mock.calls[0]![0] as URL).searchParams.get("id")).toBe(`eq.${profileId}`);
  });
  it("requires both a verified session and active profile", async () => {
    const fetchImplementation=vi.fn().mockResolvedValue(Response.json([]));
    const noSession=createSupabaseServerActorResolver({verifyUser:async()=>null,fetchImplementation});
    expect(await noSession(new Request("https://anda.test"))).toBeNull(); expect(fetchImplementation).not.toHaveBeenCalled();
    const noProfile=createSupabaseServerActorResolver({verifyUser:async()=>profileId,apiUrl:"https://project.supabase.co",secretKey:"secret",fetchImplementation});
    expect(await noProfile(new Request("https://anda.test"))).toBeNull();
  });
  it("fails closed on persistence outages", async () => {
    const resolver=createSupabaseServerActorResolver({verifyUser:async()=>profileId,apiUrl:"https://project.supabase.co",secretKey:"secret",fetchImplementation:vi.fn().mockResolvedValue(new Response(null,{status:503}))});
    await expect(resolver(new Request("https://anda.test"))).rejects.toBeInstanceOf(ServerActorResolutionError);
  });
});
describe("basic role matrix", () => {
  it.each([ ["USER",true,false,false,false], ["OFFICER",true,true,true,false], ["TREASURER",true,true,true,true] ] as const)("checks %s capabilities", (role,review,approve,discard,sign) => {
    const actor={profileId,displayName:"Member",role};
    expect(actorHasPermission(actor,"read")).toBe(true); expect(actorHasPermission(actor,"review")).toBe(review);
    expect(actorHasPermission(actor,"approve")).toBe(approve); expect(actorHasPermission(actor,"discard")).toBe(discard); expect(actorHasPermission(actor,"sign")).toBe(sign);
  });
});
