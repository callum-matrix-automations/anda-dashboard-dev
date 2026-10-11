import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// Operator-only. Do not put passwords in command arguments or application logs.
const { values } = parseArgs({ options: {
  action: { type: "string" }, id: { type: "string" }, position: { type: "string" },
} });
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Server-only Supabase credentials are required.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
if (values.action === "reset") {
  const password = process.env.ANDA_ACCOUNT_PASSWORD;
  if (!values.id || !password || password.length < 12 || password.length > 128) throw new Error("Provide --id and ANDA_ACCOUNT_PASSWORD (12–128 characters).");
  const profile = await client.from("profiles").select("id").eq("id", values.id).eq("account_type", "MEMBER").single();
  if (profile.error) throw new Error("Board account not found.");
  const updated = await client.auth.admin.updateUserById(values.id, { password });
  if (updated.error) throw new Error("Password reset failed.");
  const revoked = await client.rpc("revoke_board_account_sessions", { p_profile_id: values.id });
  if (revoked.error) throw new Error("Password changed, but session revocation failed. Retry the reset before sharing credentials.");
  console.log("Password reset and existing sessions revoked. Privately deliver the new password after verifying the member's identity; remove ANDA_ACCOUNT_PASSWORD from your shell.");
} else if (values.action === "position") {
  if (!values.id || !["PRESIDENT", "VICE_PRESIDENT", "NONE"].includes(values.position)) throw new Error("Provide --id and --position PRESIDENT|VICE_PRESIDENT|NONE for an existing Officer.");
  const updated = await client.from("profiles").update({ board_position: values.position === "NONE" ? null : values.position })
    .eq("id", values.id).eq("account_type", "MEMBER").eq("member_role", "OFFICER").select("id").single();
  if (updated.error) throw new Error("Position assignment failed. Check the Officer account and active position uniqueness.");
  console.log("Board position updated. Historical approvals and signing recipients were not changed.");
} else {
  throw new Error("Use --action reset|position. Members create their own accounts at /auth/register. This tool is for authorised operators only.");
}
