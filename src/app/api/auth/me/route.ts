import { NextResponse } from "next/server";
import { createRequestAuthClient, authResponseCookies, type AuthCookie } from "@/backend/auth/supabaseAuth";
import { loadServerActor } from "@/backend/auth/serverActor";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const pending: AuthCookie[] = [];
  try {
    const client = createRequestAuthClient(request, cookies => pending.push(...cookies));
    const {data, error} = await client.auth.getUser();
    if (error?.status && error.status >= 500) throw new Error("Authentication unavailable");
    const actor = !error && data.user ? await loadServerActor(data.user.id) : null;
    return authResponseCookies(actor ? NextResponse.json(actor) : NextResponse.json({error: {code: "authentication_required", message: "Sign in to continue."}}, {status: 401}), pending);
  } catch {
    return authResponseCookies(NextResponse.json({error: {code: "authentication_unavailable", message: "Account authentication is unavailable."}}, {status: 503}), pending);
  }
}
