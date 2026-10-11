import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AccountRegistrationRequestSchema } from "../../shared/contracts/account";

export class BoardRegistrationError extends Error {
  constructor() { super("Account creation could not be completed. Check your invitation and email, or sign in if you already created your account. Contact the account operator if you need help."); }
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
  const tokenHash = createHash("sha256").update(registration.invitationCode).digest("hex");
  const leaseId = randomUUID();
  const claim = await client.rpc("claim_board_invitation", {
    p_token_hash: tokenHash, p_email: registration.email, p_lease_id: leaseId,
  });
  if (claim.error) throw new Error("Invitation verification is unavailable.");
  if (typeof claim.data !== "string") throw new BoardRegistrationError();
  const id = claim.data;
  try {
    const created = await client.auth.admin.createUser({
      id, email: registration.email, password: registration.password, email_confirm: true,
    });
    if (created.error) {
      // Recover only this invitation's reserved UUID, never an arbitrary existing email.
      const existing = await client.auth.admin.getUserById(id);
      if (existing.error || existing.data.user?.email?.toLowerCase() !== registration.email) throw new BoardRegistrationError();
      const updated = await client.auth.admin.updateUserById(id, { password: registration.password, email_confirm: true });
      if (updated.error) throw new BoardRegistrationError();
    } else if (created.data.user?.id !== id) {
      throw new BoardRegistrationError();
    }
    const completed = await client.rpc("complete_board_registration", {
      p_token_hash: tokenHash, p_lease_id: leaseId, p_display_name: registration.displayName,
    });
    if (completed.error || completed.data !== id) throw new BoardRegistrationError();
    return { ok: true };
  } finally {
    // If an upstream response was lost, never delete Auth/profile data. The stable
    // reservation supports a safe retry; consumed invitations cannot be reused.
    await client.rpc("release_board_invitation", { p_token_hash: tokenHash, p_lease_id: leaseId });
  }
}
