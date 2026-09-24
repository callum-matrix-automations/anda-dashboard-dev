import { NextResponse } from "next/server";
import { MASTER_SESSION_COOKIE, masterSessionCookieOptions } from "@/backend/auth/masterSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/auth/sign-in", request.url), 303);
  response.cookies.set(MASTER_SESSION_COOKIE, "", {
    ...masterSessionCookieOptions(),
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
