import { NextResponse } from "next/server";
import { loginRateLimiter } from "@/backend/auth/loginRateLimit";
import { requestClientKey, requestHasTrustedOrigin } from "@/backend/auth/requestOrigin";
import { createRequestAuthClient, authResponseCookies, type AuthCookie } from "@/backend/auth/supabaseAuth";
import { loadServerActor } from "@/backend/auth/serverActor";
import { AccountLoginRequestSchema } from "@/shared/contracts/account";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) return failure(403, "invalid_origin", "The login request was rejected.");
  const parsed = AccountLoginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure(400, "invalid_request", "Enter your email and password.");
  const clientKey = requestClientKey(request), limit = loginRateLimiter.status(clientKey);
  if (limit.blocked) return failure(429, "too_many_attempts", "Too many login attempts. Try again later.", limit.retryAfterSeconds);
  const pending: AuthCookie[] = [], cacheHeaders: Record<string, string> = {};
  try {
    const client = createRequestAuthClient(request, (cookies, headers) => {pending.push(...cookies); Object.assign(cacheHeaders, headers);});
    const {data, error} = await client.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      if (error?.status && error.status >= 500) return failure(503, "authentication_unavailable", "Account sign-in is temporarily unavailable.");
      const updated = loginRateLimiter.recordFailure(clientKey);
      return failure(updated.blocked ? 429 : 401, updated.blocked ? "too_many_attempts" : "invalid_credentials",
        updated.blocked ? "Too many login attempts. Try again later." : "The email or password is incorrect.", updated.blocked ? updated.retryAfterSeconds : undefined);
    }
    const actor = await loadServerActor(data.user.id);
    if (!actor) {
      await client.auth.signOut({scope: "local"});
      return authResponseCookies(failure(403, "account_unavailable", "This account does not have access to the dashboard."), pending, cacheHeaders);
    }
    loginRateLimiter.clear(clientKey);
    const response = authResponseCookies(NextResponse.json({ok: true}), pending, cacheHeaders);
    response.cookies.set("anda_master_session", "", {httpOnly: true, path: "/", maxAge: 0});
    return response;
  } catch {
    return authResponseCookies(failure(503, "authentication_unavailable", "Account sign-in is temporarily unavailable."), pending.map(c => ({...c, value: "", options: {...c.options, maxAge: 0}})));
  }
}
function failure(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json({error: {code, message}}, {status, headers: {"Cache-Control": "private, no-store", ...(retryAfter ? {"Retry-After": String(retryAfter)} : {})}});
}
