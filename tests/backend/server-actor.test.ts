import { describe, expect, it, vi } from "vitest";
import {
  actorHasPermission,
  createSupabaseServerActorResolver,
  ServerActorResolutionError,
} from "../../src/backend/auth/serverActor";

const profileId = "11111111-1111-4111-8111-111111111111";

describe("server actor resolver", () => {
  it("loads an active local member from Supabase without trusting the request", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      id: profileId,
      account_type: "MEMBER",
      member_role: "OFFICER",
      is_admin: true,
      display_name: "Board Officer",
      account_status: "ACTIVE",
    }]));
    const resolver = createSupabaseServerActorResolver({
      apiUrl: "http://127.0.0.1:54321",
      secretKey: "server-secret",
      developmentProfileId: profileId,
      nodeEnvironment: "development",
      fetchImplementation,
    });

    await expect(resolver(new Request("https://anda.test/api/meetings", {
      headers: { "x-actor-profile-id": "attacker-controlled" },
    }))).resolves.toEqual({
      profileId,
      displayName: "Board Officer",
      role: "OFFICER",
      isAdmin: true,
    });
    const [url, init] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("id")).toBe(`eq.${profileId}`);
    expect(init.headers).toMatchObject({
      apikey: "server-secret",
      authorization: "Bearer server-secret",
    });
  });

  it("fails closed without a configured identity or in production", async () => {
    const fetchImplementation = vi.fn();
    const missing = createSupabaseServerActorResolver({
      nodeEnvironment: "development",
      developmentProfileId: "",
      fetchImplementation,
    });
    const production = createSupabaseServerActorResolver({
      nodeEnvironment: "production",
      developmentProfileId: profileId,
      fetchImplementation,
    });

    await expect(missing(new Request("https://anda.test"))).resolves.toBeNull();
    await expect(production(new Request("https://anda.test"))).resolves.toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("uses the configured staging identity in a production Railway process", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      id: profileId,
      account_type: "MEMBER",
      member_role: "TREASURER",
      is_admin: false,
      display_name: "John Smith",
      account_status: "ACTIVE",
    }]));
    const resolver = createSupabaseServerActorResolver({
      apiUrl: "https://project.supabase.co",
      secretKey: "sb_secret_hosted",
      stagingProfileId: profileId,
      applicationEnvironment: "staging",
      nodeEnvironment: "production",
      fetchImplementation,
    });

    await expect(resolver(new Request("https://staging.anda.test"))).resolves.toEqual({
      profileId,
      displayName: "John Smith",
      role: "TREASURER",
      isAdmin: false,
    });
    const [, init] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(init.headers).toMatchObject({ apikey: "sb_secret_hosted" });
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("does not enable the staging identity outside the explicit staging environment", async () => {
    const fetchImplementation = vi.fn();
    const resolver = createSupabaseServerActorResolver({
      stagingProfileId: profileId,
      applicationEnvironment: "production",
      nodeEnvironment: "production",
      fetchImplementation,
    });

    await expect(resolver(new Request("https://anda.test"))).resolves.toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not authenticate missing or inactive profiles", async () => {
    const resolver = createSupabaseServerActorResolver({
      apiUrl: "http://127.0.0.1:54321",
      secretKey: "server-secret",
      developmentProfileId: profileId,
      nodeEnvironment: "test",
      fetchImplementation: vi.fn().mockResolvedValue(Response.json([])),
    });

    await expect(resolver(new Request("https://anda.test"))).resolves.toBeNull();
  });

  it("reports invalid configuration and persistence failures without exposing them as identities", async () => {
    const invalid = createSupabaseServerActorResolver({
      developmentProfileId: "not-a-uuid",
      nodeEnvironment: "test",
    });
    const unavailable = createSupabaseServerActorResolver({
      apiUrl: "http://127.0.0.1:54321",
      secretKey: "server-secret",
      developmentProfileId: profileId,
      nodeEnvironment: "test",
      fetchImplementation: vi.fn().mockRejectedValue(new Error("network details")),
    });

    await expect(invalid(new Request("https://anda.test"))).rejects.toBeInstanceOf(ServerActorResolutionError);
    await expect(unavailable(new Request("https://anda.test"))).rejects.toMatchObject({
      code: "actor_resolution_failed",
    });
  });
});

describe("meeting role policy", () => {
  const base = { profileId, displayName: "Member", isAdmin: false };

  it("allows all active members to read and preserves the role hierarchy", () => {
    expect(actorHasPermission({ ...base, role: "USER" }, "read")).toBe(true);
    expect(actorHasPermission({ ...base, role: "USER" }, "review")).toBe(false);
    expect(actorHasPermission({ ...base, role: "OFFICER" }, "review")).toBe(true);
    expect(actorHasPermission({ ...base, role: "OFFICER" }, "sign")).toBe(false);
    expect(actorHasPermission({ ...base, role: "TREASURER" }, "review")).toBe(true);
    expect(actorHasPermission({ ...base, role: "TREASURER" }, "sign")).toBe(true);
  });

  it("does not treat account administration as a meeting-workflow role", () => {
    expect(actorHasPermission({ ...base, role: "USER", isAdmin: true }, "review")).toBe(false);
    expect(actorHasPermission({ ...base, role: "USER", isAdmin: true }, "sign")).toBe(false);
  });
});
