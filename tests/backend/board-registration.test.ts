import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerBoardMember, BoardRegistrationError } from "../../src/backend/auth/registerBoardMember";
import { AccountRegistrationRequestSchema } from "../../src/shared/contracts/account";
const id = "11111111-1111-4111-8111-111111111111";
const input = { email: "member@example.test", displayName: "Board Member", password: "member-chosen-password", invitationCode: "a".repeat(43) };
function admin() {
  const rpc = vi.fn().mockImplementation(async (name: string) => ({ data: name === "release_board_invitation" ? null : id, error: null }));
  const auth = { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id } }, error: null }),
    getUserById: vi.fn(), updateUserById: vi.fn() } };
  return { rpc, auth };
}
describe("invited board registration", () => {
  it("creates only the reserved identity and completes server-controlled USER provisioning", async () => {
    const client = admin();
    expect(await registerBoardMember(input, client as unknown as SupabaseClient)).toEqual({ ok: true });
    expect(client.auth.admin.createUser).toHaveBeenCalledWith({ id, email: input.email, password: input.password, email_confirm: true });
    expect(client.rpc.mock.calls[0]?.[1]).not.toHaveProperty("password");
    expect(client.rpc.mock.calls[0]?.[1].p_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(client.rpc.mock.calls[1]?.[1]).not.toHaveProperty("role");
  });
  it.each(["role", "boardPosition", "is_admin", "account_status"])("rejects privilege injection through %s", async field => {
    const client = admin();
    await expect(registerBoardMember({ ...input, [field]: "PRESIDENT" }, client as unknown as SupabaseClient)).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it("does not create Auth accounts for unavailable, expired, consumed or mismatched invitations", async () => {
    const client = admin(); client.rpc.mockResolvedValue({ data: null, error: null });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toBeInstanceOf(BoardRegistrationError);
    expect(client.auth.admin.createUser).not.toHaveBeenCalled();
  });
  it("recovers only an incomplete account with this invitation's reserved UUID", async () => {
    const client = admin();
    client.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: "exists" } });
    client.auth.admin.getUserById.mockResolvedValue({ data: { user: { id, email: input.email } }, error: null });
    client.auth.admin.updateUserById.mockResolvedValue({ error: null });
    expect(await registerBoardMember(input, client as unknown as SupabaseClient)).toEqual({ ok: true });
    expect(client.auth.admin.updateUserById).toHaveBeenCalledWith(id, { password: input.password, email_confirm: true });
  });
  it("never takes over an unrelated existing email and releases the reservation after failure", async () => {
    const client = admin();
    client.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: { message: "exists" } });
    client.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: { message: "not found" } });
    await expect(registerBoardMember(input, client as unknown as SupabaseClient)).rejects.toBeInstanceOf(BoardRegistrationError);
    expect(client.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.at(-1)?.[0]).toBe("release_board_invitation");
  });
  it("normalizes email and enforces bounded passwords and invitation codes", () => {
    expect(AccountRegistrationRequestSchema.parse({ ...input, email: " MEMBER@EXAMPLE.TEST " }).email).toBe(input.email);
    expect(AccountRegistrationRequestSchema.safeParse({ ...input, password: "short" }).success).toBe(false);
    expect(AccountRegistrationRequestSchema.safeParse({ ...input, password: "x".repeat(129) }).success).toBe(false);
  });
});
