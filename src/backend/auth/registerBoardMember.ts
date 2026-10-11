import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AccountRegistrationRequestSchema } from "../../shared/contracts/account";

export class BoardRegistrationError extends Error {
  constructor() { super("Account creation could not be completed. Check your details, or sign in if you already have an account. Contact the account operator if you need help."); }
}
export function createAccountAdminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Account administration is unavailable.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
}
export async function registerBoardMember(input: unknown, client: SupabaseClient = createAccountAdminClient()) {
  const registration = AccountRegistrationRequestSchema.parse(input);
  const created = await client.auth.admin.createUser({
    email: registration.email, password: registration.password, email_confirm: true,
  });
  // Auth enforces email uniqueness. Never reset or reuse an existing account on signup.
  if (created.error || !created.data.user) throw new BoardRegistrationError();
  const id = created.data.user.id;
  const profile = {
    id, email: registration.email, display_name: registration.displayName,
    account_type: "MEMBER", member_role: "USER", account_status: "ACTIVE",
    board_position: null, is_admin: false,
  };
  const inserted = await client.from("profiles").insert(profile);
  if (inserted.error) {
    // A response can be lost after a successful insert. Check our newly created
    // identity before cleanup; never remove an account with a committed profile.
    const existing = await client.from("profiles").select("id").eq("id", id).maybeSingle();
    if (existing.error) throw new Error("Account activation could not be verified.");
    if (existing.data) return { ok: true };
    const rollback = await client.auth.admin.deleteUser(id);
    if (rollback.error) throw new Error("Account activation requires operator assistance.");
    throw new Error("Account activation is temporarily unavailable.");
  }
  return { ok: true };
}
