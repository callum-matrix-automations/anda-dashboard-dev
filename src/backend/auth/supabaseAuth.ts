import { createServerClient, parseCookieHeader, type CookieOptions } from "@supabase/ssr";
import type { NextResponse } from "next/server";

export class AuthConfigurationError extends Error {}
export type AuthCookie = { name: string; value: string; options: CookieOptions };
export function authConfiguration() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || key.startsWith("replace-")) throw new AuthConfigurationError("Account sign-in is not configured.");
  return { url, key };
}
export function createRequestAuthClient(request: Request, write?: (cookies: AuthCookie[], headers: Record<string, string>) => void) {
  const { url, key } = authConfiguration();
  const jar = new Map(parseCookieHeader(request.headers.get("cookie") ?? "").map(({ name, value }) => [name, value ?? ""]));
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (cookies, headers) => {
        cookies.forEach(({name, value}) => jar.set(name, value));
        write?.(cookies, headers);
      },
    },
  });
}
export function authResponseCookies(response: NextResponse, cookies: AuthCookie[], headers: Record<string, string> = {}) {
  cookies.forEach(({name, value, options}) => response.cookies.set(name, value, options));
  Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
