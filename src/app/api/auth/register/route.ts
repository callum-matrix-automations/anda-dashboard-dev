import { NextResponse } from "next/server";
import { AccountRegistrationRequestSchema } from "@/shared/contracts/account";
import { BoardRegistrationError, registerBoardMember } from "@/backend/auth/registerBoardMember";
import { LoginRateLimiter } from "@/backend/auth/loginRateLimit";
import { requestClientKey, requestHasTrustedOrigin } from "@/backend/auth/requestOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const limiter = new LoginRateLimiter(15 * 60 * 1000, 10);
export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) return failure(403, "invalid_origin", "The registration request was rejected.");
  const key = requestClientKey(request);
  const limit = limiter.status(key);
  if (limit.blocked) return failure(429, "too_many_attempts", "Too many attempts. Try again later.", limit.retryAfterSeconds);
  // Count all requests, including successful ones, to bound administration calls.
  limiter.recordFailure(key);
  try {
    const body = await request.text();
    if (body.length > 4096) return failure(400, "invalid_registration", "Check your name, email and password (12–128 characters).");
    const parsed = AccountRegistrationRequestSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return failure(400, "invalid_registration", "Check your name, email and password (12–128 characters).");
    return NextResponse.json(await registerBoardMember(parsed.data), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError) return failure(400, "invalid_registration", "Check your registration details.");
    if (error instanceof BoardRegistrationError) return failure(400, "registration_unavailable", error.message);
    return failure(503, "registration_unavailable", "Account creation is temporarily unavailable. Please try again or contact the account operator.");
  }
}
function failure(status: number, code: string, message: string, retryAfter?: number) {
  return NextResponse.json({ error: { code, message } }, { status, headers: {
    "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}),
  } });
}
