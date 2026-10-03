import { NextRequest, NextResponse } from "next/server";
import { createRequestAuthClient, authResponseCookies, type AuthCookie } from "@/backend/auth/supabaseAuth";
import { loadServerActor } from "@/backend/auth/serverActor";
import { requestHasTrustedOrigin } from "@/backend/auth/requestOrigin";
const SIGN_IN_PATH = "/auth/sign-in";
export async function middleware(request: NextRequest) {
  const {pathname} = request.nextUrl;
  if (pathname.startsWith("/api/auth/") || ["/api/webhooks/", "/api/internal/"].some(prefix => pathname.startsWith(prefix))) return NextResponse.next();
  const pending: AuthCookie[] = [], cacheHeaders: Record<string, string> = {};
  let authenticated = false, available = true;
  try {
    const client = createRequestAuthClient(request, (cookies, headers) => {
      cookies.forEach(({name, value}) => request.cookies.set(name, value));
      pending.push(...cookies); Object.assign(cacheHeaders, headers);
    });
    const {data, error} = await client.auth.getUser();
    if (error?.status && error.status >= 500) available = false;
    authenticated = Boolean(!error && data.user && await loadServerActor(data.user.id));
  } catch { available = false; }
  const finish = (response: NextResponse) => authResponseCookies(response, pending, cacheHeaders);
  if (pathname === SIGN_IN_PATH) {
    if (!authenticated) return finish(NextResponse.next({request}));
    return finish(NextResponse.redirect(new URL(safeReturnTo(request.nextUrl.searchParams.get("returnTo")), request.url)));
  }
  if (pathname.startsWith("/auth/")) return finish(NextResponse.redirect(new URL(SIGN_IN_PATH, request.url)));
  if (authenticated) {
    if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method) && !requestHasTrustedOrigin(request))
      return finish(NextResponse.json({error: {code: "invalid_origin", message: "The request was rejected."}}, {status: 403}));
    return finish(NextResponse.next({request}));
  }
  if (pathname.startsWith("/api/")) return finish(NextResponse.json({error: {code: available ? "authentication_required" : "authentication_unavailable",
    message: available ? "Sign in to use the dashboard." : "Account sign-in is unavailable."}}, {status: available ? 401 : 503}));
  const url = new URL(SIGN_IN_PATH, request.url);
  if (pathname.startsWith("/app/")) url.searchParams.set("returnTo", pathname + request.nextUrl.search);
  if (!available) url.searchParams.set("error", "configuration");
  return finish(NextResponse.redirect(url));
}
export const config = {matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)$).*)"]};
function safeReturnTo(value: string | null) { return value?.startsWith("/app/") && !value.startsWith("//") ? value : "/app/dashboard"; }
