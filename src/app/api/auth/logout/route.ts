import { NextResponse } from "next/server";
import { parseCookieHeader } from "@supabase/ssr";
import { createRequestAuthClient, authResponseCookies, type AuthCookie } from "@/backend/auth/supabaseAuth";
import { requestHasTrustedOrigin } from "@/backend/auth/requestOrigin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) return NextResponse.json({error: {code: "invalid_origin", message: "The logout request was rejected."}}, {status: 403});
  const pending: AuthCookie[] = [];
  try {
    const client = createRequestAuthClient(request, cookies => pending.push(...cookies));
    await client.auth.signOut({scope: "local"});
  } catch { /* Clearing local cookies ends browser access if Auth is unavailable. */ }
  const response = authResponseCookies(NextResponse.redirect(new URL("/auth/sign-in", process.env.APP_ORIGIN ?? request.url), 303), pending);
  for (const {name} of parseCookieHeader(request.headers.get("cookie") ?? "")) {
    if (name.startsWith("sb-") || name === "anda_master_session") response.cookies.set(name, "", {httpOnly: true, path: "/", maxAge: 0});
  }
  return response;
}
