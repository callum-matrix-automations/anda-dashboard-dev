import { NextResponse } from "next/server";
import { masterLoginRateLimiter } from "@/backend/auth/masterLoginRateLimit";
import { verifyMasterCredentials } from "@/backend/auth/masterPassword";
import { requestClientKey, requestHasTrustedOrigin } from "@/backend/auth/requestOrigin";
import {
  MASTER_SESSION_COOKIE,
  MasterAuthConfigurationError,
  createMasterSessionToken,
  getMasterAuthConfiguration,
  masterSessionCookieOptions,
} from "@/backend/auth/masterSession";
import { MasterLoginRequestSchema } from "@/shared/contracts/masterAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) {
    return errorResponse(403, "invalid_origin", "The login request was rejected.");
  }

  const parsed = MasterLoginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, "invalid_request", "Enter a username and password.");
  }

  let configuration;
  try {
    configuration = getMasterAuthConfiguration();
  } catch (error) {
    if (error instanceof MasterAuthConfigurationError) {
      return errorResponse(503, "authentication_unavailable", "Master login is not configured.");
    }
    throw error;
  }

  const clientKey = requestClientKey(request);
  const rateLimit = masterLoginRateLimiter.status(clientKey);
  if (rateLimit.blocked) {
    return errorResponse(
      429,
      "too_many_attempts",
      "Too many login attempts. Try again later.",
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  let credentialsValid = false;
  try {
    credentialsValid = await verifyMasterCredentials(
      parsed.data.username,
      parsed.data.password,
      configuration,
    );
  } catch {
    return errorResponse(503, "authentication_unavailable", "Master login is not configured.");
  }

  if (!credentialsValid) {
    const updatedLimit = masterLoginRateLimiter.recordFailure(clientKey);
    return errorResponse(
      updatedLimit.blocked ? 429 : 401,
      updatedLimit.blocked ? "too_many_attempts" : "invalid_credentials",
      updatedLimit.blocked
        ? "Too many login attempts. Try again later."
        : "The username or password is incorrect.",
      updatedLimit.blocked ? { "Retry-After": String(updatedLimit.retryAfterSeconds) } : undefined,
    );
  }

  masterLoginRateLimiter.clear(clientKey);
  const token = await createMasterSessionToken(configuration);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    MASTER_SESSION_COOKIE,
    token,
    masterSessionCookieOptions(process.env.NODE_ENV, configuration.sessionHours),
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return NextResponse.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...headers,
      },
    },
  );
}
