import { SignJWT } from "jose/jwt/sign";
import { jwtVerify } from "jose/jwt/verify";

export const MASTER_SESSION_COOKIE = "anda_master_session";
export const DEFAULT_MASTER_SESSION_HOURS = 12;

const MASTER_SESSION_ISSUER = "anda-dashboard";
const MASTER_SESSION_AUDIENCE = "anda-master-access";
const textEncoder = new TextEncoder();

export interface MasterAuthConfiguration {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  sessionHours: number;
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
  const passwordHash = environment.MASTER_AUTH_PASSWORD_HASH?.trim() ?? "";
  const sessionSecret = environment.MASTER_AUTH_SESSION_SECRET?.trim() ?? "";
  const sessionHours = parseSessionHours(environment.MASTER_AUTH_SESSION_HOURS);

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    throw new MasterAuthConfigurationError(
      "MASTER_AUTH_USERNAME must contain 3-64 letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (!passwordHash) {
    throw new MasterAuthConfigurationError("MASTER_AUTH_PASSWORD_HASH is not configured.");
  }
  if (textEncoder.encode(sessionSecret).byteLength < 32) {
    throw new MasterAuthConfigurationError(
      "MASTER_AUTH_SESSION_SECRET must contain at least 32 bytes of entropy.",
    );
  }

  return { username, passwordHash, sessionSecret, sessionHours };
}

export async function createMasterSessionToken(
  configuration: MasterAuthConfiguration,
  now = Date.now(),
) {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + configuration.sessionHours * 60 * 60;
  const credentialVersion = await credentialBinding(configuration);

  return new SignJWT({ credentialVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(configuration.username)
    .setIssuer(MASTER_SESSION_ISSUER)
    .setAudience(MASTER_SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(textEncoder.encode(configuration.sessionSecret));
}

export async function verifyMasterSessionToken(
  token: string | undefined,
  configuration: MasterAuthConfiguration,
  now = Date.now(),
): Promise<MasterSession | null> {
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, textEncoder.encode(configuration.sessionSecret), {
      algorithms: ["HS256"],
      issuer: MASTER_SESSION_ISSUER,
      audience: MASTER_SESSION_AUDIENCE,
      currentDate: new Date(now),
    });
    if (
      payload.sub !== configuration.username
      || typeof payload.iat !== "number"
      || typeof payload.exp !== "number"
      || payload.credentialVersion !== await credentialBinding(configuration)
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
  sessionHours = DEFAULT_MASTER_SESSION_HOURS,
) {
  return {
    httpOnly: true,
    secure: nodeEnvironment === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: sessionHours * 60 * 60,
    priority: "high" as const,
  };
}

async function credentialBinding(configuration: MasterAuthConfiguration) {
  const input = textEncoder.encode(`${configuration.username}\0${configuration.passwordHash}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseSessionHours(value: string | undefined) {
  if (!value?.trim()) return DEFAULT_MASTER_SESSION_HOURS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
    throw new MasterAuthConfigurationError(
      "MASTER_AUTH_SESSION_HOURS must be a whole number between 1 and 168.",
    );
  }
  return parsed;
}
