import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

export const MASTER_SESSION_COOKIE = "anda_master_session";
export const DEFAULT_MASTER_SESSION_HOURS = 12;

const MASTER_SESSION_ISSUER = "anda-dashboard";
const MASTER_SESSION_AUDIENCE = "anda-master-access";
const textEncoder = new TextEncoder();

export interface MasterAuthConfiguration {
  username: string;
  password: string;
}

export interface MasterSession {
  username: string;
  issuedAt: number;
  expiresAt: number;
}

export class MasterAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterAuthConfigurationError";
  }
}

export function normalizeMasterUsername(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function getMasterAuthConfiguration(
  environment: Record<string, string | undefined> = process.env,
): MasterAuthConfiguration {
  const username = normalizeMasterUsername(environment.MASTER_AUTH_USERNAME ?? "");
  const password = environment.MASTER_AUTH_PASSWORD ?? "";

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new MasterAuthConfigurationError(
      "MASTER_AUTH_USERNAME must contain 3-64 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (!password) {
    throw new MasterAuthConfigurationError("MASTER_AUTH_PASSWORD is not configured.");
  }

  return { username, password };
}

export async function createMasterSessionToken(
  configuration: MasterAuthConfiguration,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + DEFAULT_MASTER_SESSION_HOURS * 60 * 60;

  return new SignJWT()
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(configuration.username)
    .setIssuer(MASTER_SESSION_ISSUER)
    .setAudience(MASTER_SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(await sessionSigningKey(configuration));
}

export async function verifyMasterSessionToken(
  token: string | undefined,
  configuration: MasterAuthConfiguration,
  now = Date.now(),
): Promise<MasterSession | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, await sessionSigningKey(configuration), {
      algorithms: ["HS256"],
      issuer: MASTER_SESSION_ISSUER,
      audience: MASTER_SESSION_AUDIENCE,
      currentDate: new Date(now),
    });
    if (
      payload.sub !== configuration.username
      || typeof payload.iat !== "number"
      || typeof payload.exp !== "number"
    ) {
      return null;
    }
    return {
      username: payload.sub,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function masterSessionCookieOptions(
  nodeEnvironment = process.env.NODE_ENV,
) {
  return {
    httpOnly: true,
    secure: nodeEnvironment === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: DEFAULT_MASTER_SESSION_HOURS * 60 * 60,
    priority: "high" as const,
  };
}

async function sessionSigningKey(configuration: MasterAuthConfiguration) {
  const input = textEncoder.encode(
    `anda-master-session\0${configuration.username}\0${configuration.password}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return digest;
}
