import { decodeJwt } from "jose/jwt/decode";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServerHeaders } from "../repositories/supabase/supabaseServerHeaders";

// Call only after getUser has verified this client's token with Supabase Auth.
export async function hasActiveAccountSession(client: SupabaseClient, profileId: string) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) return false;
  const sessionId = z.string().uuid().safeParse(decodeJwt(data.session.access_token).session_id);
  if (!sessionId.success) return false;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Session verification is unavailable.");
  const response = await fetch(new URL("/rest/v1/rpc/account_session_is_active", url), {
    method: "POST", headers: { ...supabaseServerHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ p_profile_id: profileId, p_session_id: sessionId.data }), cache: "no-store",
  });
  if (!response.ok) throw new Error("Session verification is unavailable.");
  return await response.json() === true;
}
