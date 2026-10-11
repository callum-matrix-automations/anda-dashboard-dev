import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerBoardMember, BoardRegistrationError } from "../../src/backend/auth/registerBoardMember";
import { AccountRegistrationRequestSchema } from "../../src/shared/contracts/account";
const id = "11111111-1111-4111-8111-111111111111";
const input = { email: "member@example.test", displayName: "Board Member", password: "member-chosen-password" };
function admin() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ insert, select });
  const auth = { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }),
    deleteUser: vi.fn().mockResolvedValue({ error: null }), updateUserById: vi.fn() } };
  return { from, insert, maybeSingle, eq, auth };
}
describe("self-service board registration", () => {
  it("creates an immediately active read-only Member without any invitation", async () => {
    const client = admin();
    expect(await registerBoardMember(input, client as unknown as SupabaseClient)).toEqual({ ok: true });
    expect(client.auth.admin.createUser).toHaveBeenCalledWith({ email: input.email, password: input.password, email_confirm: true });
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(client.insert).toHaveBeenCalledWith({ id, email: input.email, display_name: input.displayName,
      account_type: "MEMBER", member_role: "USER", account_status: "ACTIVE", board_position: null, is_admin: false });
    expect(client.insert.mock.calls[0]![0]).not.toHaveProperty("password");
  });
  it.each(["role", "member_role", "boardPosition", "board_position", "account_type", "is_admin", "account_status"])("rejects privilege injection through %s", async field => {
    const client = admin();
    await expect(registerBoardMember({ ...input, [field]: "PRESIDENT" }, client as unknown as SupabaseClient)).rejects.toThrow();
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it("never resets, reuses or removes an existing account on duplicate registration", async () => {
    const client = admin();
    client.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: "exists" } });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toBeInstanceOf(BoardRegistrationError);
    expect(client.insert).not.toHaveBeenCalled();
    expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it("cleans up only the newly created Auth-only identity when profile creation fails", async () => {
    const client = admin(); client.insert.mockResolvedValue({ error: { message: "failed" } });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toThrow("temporarily unavailable");
    expect(client.eq).toHaveBeenCalledWith("id", id);
    expect(client.auth.admin.deleteUser).toHaveBeenCalledWith(id);
  });
  it("accepts a committed profile after a lost insert response without removing the account", async () => {
    const client = admin(); client.insert.mockResolvedValue({ error: { message: "response lost" } });
    client.maybeSingle.mockResolvedValue({ data: { id }, error: null });
    expect(await registerBoardMember(input, client as unknown as SupabaseClient)).toEqual({ ok: true });
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it("does not remove an identity when the profile existence check is unavailable", async () => {
    const client = admin(); client.insert.mockResolvedValue({ error: { message: "response lost" } });
    client.maybeSingle.mockResolvedValue({ data: null, error: { message: "network" } });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toThrow("could not be verified");
    expect(client.auth.admin.deleteUser).not.toHaveBeenCalled();
  });
  it("reports an incomplete activation when cleanup fails", async () => {
    const client = admin(); client.insert.mockResolvedValue({ error: { message: "failed" } });
    client.auth.admin.deleteUser.mockResolvedValue({ error: { message: "failed" } });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toThrow("operator assistance");
  });
  it("normalizes email and name and enforces bounded passwords without an invitation field", () => {
    expect(AccountRegistrationRequestSchema.parse({ ...input, email: " MEMBER@EXAMPLE.TEST ", displayName: " Board Member " })).toEqual(input);
    expect(AccountRegistrationRequestSchema.safeParse({ ...input, password: "short" }).success).toBe(false);
    expect(AccountRegistrationRequestSchema.safeParse({ ...input, password: "x".repeat(129) }).success).toBe(false);
  });
});
