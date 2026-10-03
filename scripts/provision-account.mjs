import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// Operator tool; never imported by the app. Passwords come from a temporary
// environment variable, not shell arguments, logs or committed configuration.
const { values } = parseArgs({ options: {
  email: { type: "string" }, role: { type: "string" }, name: { type: "string" },
  "first-name": { type: "string" }, "last-name": { type: "string" },
} });
const email = values.email?.trim().toLowerCase();
const password = process.env.ANDA_ACCOUNT_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !values.name?.trim()
  || !["USER", "OFFICER", "TREASURER"].includes(values.role) || !password || password.length < 12
  || (values.role === "TREASURER" && (!values["first-name"]?.trim() || !values["last-name"]?.trim()))) {
  throw new Error("Provide --email, --name, --role USER|OFFICER|TREASURER and ANDA_ACCOUNT_PASSWORD (12+ characters). Treasurer also requires --first-name and --last-name.");
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) throw new Error("Server-only Supabase URL and secret key are required.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
if (values.role === "TREASURER") {
  const { data, error } = await client.from("profiles").select("id").eq("member_role", "TREASURER").eq("account_status", "ACTIVE");
  if (error) throw new Error("Treasurer preflight failed. Check migrations and credentials.");
  if (data.length) throw new Error("An active Treasurer already exists. Resolve the existing profile manually before provisioning a replacement; signing snapshots must be preserved.");
}
const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true });
if (error || !data.user) throw new Error("Auth account creation failed. Check whether the email already exists and the operator credentials are valid.");
const { error: profileError } = await client.from("profiles").insert({
  id: data.user.id, account_type: "MEMBER", member_role: values.role,
  display_name: values.name.trim(), email, account_status: "ACTIVE",
  signing_first_name: values["first-name"]?.trim() ?? null,
  signing_last_name: values["last-name"]?.trim() ?? null,
});
if (profileError) {
  const rollback = await client.auth.admin.deleteUser(data.user.id);
  throw new Error(rollback.error ? `Profile creation failed. Auth-only account ${data.user.id} needs operator cleanup.` : "Profile creation failed; the newly created Auth-only account was removed.");
}
console.log(`Created ${values.role} account ${data.user.id}. Share credentials privately and remove ANDA_ACCOUNT_PASSWORD from your shell.`);
