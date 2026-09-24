import { NextRequest, NextResponse } from "next/server";
import {
  MASTER_SESSION_COOKIE,
  MasterAuthConfigurationError,
  getMasterAuthConfiguration,
  verifyMasterSessionToken,
} from "@/backend/auth/masterSession";

const SIGN_IN_PATH = "/auth/sign-in";
const SERVICE_AUTH_PREFIXES = ["/api/webhooks/", "/api/internal/"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/auth/") || SERVICE_AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  let authenticated = false;
  let configurationAvailable = true;
  try {
    const configuration = getMasterAuthConfiguration();
    authenticated = Boolean(await verifyMasterSessionToken(
      request.cookies.get(MASTER_SESSION_COOKIE)?.value,
      configuration,
    ));
  } catch (error) {
    if (error instanceof MasterAuthConfigurationError) configurationAvailable = false;
    else throw error;
  }

  if (pathname === SIGN_IN_PATH) {
    if (!authenticated) return NextResponse.next();
    const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  if (pathname.startsWith("/auth/")) {
    return NextResponse.redirect(new URL(SIGN_IN_PATH, request.url));
  }

  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: {
          code: configurationAvailable ? "authentication_required" : "authentication_unavailable",
          message: configurationAvailable
            ? "Sign in to use the ANDA Dashboard API."
            : "Master login is not configured.",
        },
      },
      {
        status: configurationAvailable ? 401 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const signInUrl = new URL(SIGN_IN_PATH, request.url);
  const returnTo = `${pathname}${request.nextUrl.search}`;
  if (returnTo.startsWith("/app/")) signInUrl.searchParams.set("returnTo", returnTo);
  if (!configurationAvailable) signInUrl.searchParams.set("error", "configuration");
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)$).*)"],
};

function safeReturnTo(value: string | null) {
  return value?.startsWith("/app/") && !value.startsWith("//") ? value : "/app/dashboard";
}
