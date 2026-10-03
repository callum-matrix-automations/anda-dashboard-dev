import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../src/middleware";
import { POST as login } from "../../src/app/api/auth/login/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";
import { GET as me } from "../../src/app/api/auth/me/route";
import { LoginRateLimiter } from "../../src/backend/auth/loginRateLimit";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), loadActor: vi.fn() }));
vi.mock("../../src/backend/auth/supabaseAuth", async importOriginal => {
  const original = await importOriginal<typeof import("../../src/backend/auth/supabaseAuth")>();
  return { ...original, createRequestAuthClient: vi.fn(() => ({ auth: mocks })) };
});
vi.mock("../../src/backend/auth/serverActor", async importOriginal => ({
  ...await importOriginal<typeof import("../../src/backend/auth/serverActor")>(), loadServerActor: mocks.loadActor,
}));
const id="10000000-0000-4000-8000-000000000003";
const actor={profileId:id,displayName:"Test Member",role:"USER"};
beforeEach(() => { vi.resetAllMocks(); mocks.getUser.mockResolvedValue({data:{user:null},error:null}); mocks.signOut.mockResolvedValue({error:null}); vi.stubEnv("APP_ORIGIN","https://anda.test"); });
afterEach(() => vi.unstubAllEnvs());
const loginRequest=(body:unknown,origin="https://anda.test")=>new Request("https://anda.test/api/auth/login",{method:"POST",headers:{origin,"content-type":"application/json","x-real-ip":crypto.randomUUID()},body:JSON.stringify(body)});
describe("individual account authentication", () => {
  it("redirects unauthenticated pages, denies APIs and ignores legacy master cookies", async () => {
    const page=await middleware(new NextRequest("https://anda.test/app/meetings?queue=review",{headers:{cookie:"anda_master_session=old-token"}}));
    expect(page.headers.get("location")).toContain("returnTo=%2Fapp%2Fmeetings%3Fqueue%3Dreview");
    expect((await middleware(new NextRequest("https://anda.test/api/meetings"))).status).toBe(401);
  });
  it("checks the verified user and active profile on every protected request", async () => {
    mocks.getUser.mockResolvedValue({data:{user:{id}},error:null}); mocks.loadActor.mockResolvedValue(actor);
    expect((await middleware(new NextRequest("https://anda.test/app/dashboard"))).headers.get("x-middleware-next")).toBe("1");
    expect(mocks.loadActor).toHaveBeenCalledWith(id);
    mocks.loadActor.mockResolvedValue(null);
    expect((await middleware(new NextRequest("https://anda.test/api/meetings"))).status).toBe(401);
  });
  it("fails closed during an auth outage and leaves bearer/HMAC routes independent", async () => {
    mocks.getUser.mockRejectedValue(new Error("outage"));
    expect((await middleware(new NextRequest("https://anda.test/api/meetings"))).status).toBe(503);
    for (const path of ["/api/webhooks/firma","/api/internal/operations/recover"]) expect((await middleware(new NextRequest("https://anda.test"+path))).headers.get("x-middleware-next")).toBe("1");
  });
  it("requires email/password and rejects cross-origin sign-in", async () => {
    expect((await login(loginRequest({username:"old",password:"test"}))).status).toBe(400);
    expect((await login(loginRequest({email:"member@example.test",password:"test"},"https://attacker.test"))).status).toBe(403);
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
  it("normalizes email, validates active access and expires the old cookie", async () => {
    mocks.signInWithPassword.mockResolvedValue({data:{user:{id}},error:null}); mocks.loadActor.mockResolvedValue(actor);
    const response=await login(loginRequest({email:" Member@Example.test ",password:"test"}));
    expect(response.status).toBe(200); expect(mocks.signInWithPassword).toHaveBeenCalledWith({email:"member@example.test",password:"test"});
    expect(response.headers.get("set-cookie")).toContain("anda_master_session=;");
    mocks.loadActor.mockResolvedValue(null);
    expect((await login(loginRequest({email:"member@example.test",password:"test"}))).status).toBe(403);
    expect(mocks.signOut).toHaveBeenCalledWith({scope:"local"});
  });
  it("returns generic credential errors and limits repeated failures", async () => {
    mocks.signInWithPassword.mockResolvedValue({data:{user:null},error:{status:400}});
    const response=await login(loginRequest({email:"member@example.test",password:"wrong"}));
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({error:{code:"invalid_credentials"}});
    const limiter=new LoginRateLimiter(1000,2); limiter.recordFailure("client",0); limiter.recordFailure("client",1);
    expect(limiter.status("client",2).blocked).toBe(true); expect(limiter.status("client",1001).blocked).toBe(false);
  });
  it("exposes only the current verified account and clears all session chunks on logout", async () => {
    mocks.getUser.mockResolvedValue({data:{user:{id}},error:null}); mocks.loadActor.mockResolvedValue(actor);
    expect(await (await me(new Request("https://anda.test/api/auth/me"))).json()).toEqual(actor);
    const response=await logout(new Request("https://anda.test/api/auth/logout",{method:"POST",headers:{origin:"https://anda.test",cookie:"sb-project-auth-token.0=chunk0; sb-project-auth-token.1=chunk1; anda_master_session=old"}}));
    expect(response.status).toBe(303); expect(response.headers.get("set-cookie")).toContain("sb-project-auth-token.1=;");
  });
  it("uses explicit hosted APP_ORIGIN behind a proxy and rejects other origins", async () => {
    mocks.getUser.mockResolvedValue({data:{user:{id}},error:null}); mocks.loadActor.mockResolvedValue(actor);
    const request=(origin:string)=>new NextRequest("http://internal:3000/api/meetings",{method:"POST",headers:{origin}});
    expect((await middleware(request("https://anda.test"))).headers.get("x-middleware-next")).toBe("1");
    expect((await middleware(request("https://attacker.test"))).status).toBe(403);
  });
});
