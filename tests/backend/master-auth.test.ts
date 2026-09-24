import { describe, expect, it } from "vitest";
import { MasterLoginRateLimiter } from "../../src/backend/auth/masterLoginRateLimit";
import {
  assertPasswordStrength,
  hashMasterPassword,
  verifyMasterCredentials,
} from "../../src/backend/auth/masterPassword";
import {
  MasterAuthConfigurationError,
  createMasterSessionToken,
  getMasterAuthConfiguration,
  masterSessionCookieOptions,
  verifyMasterSessionToken,
  type MasterAuthConfiguration,
} from "../../src/backend/auth/masterSession";

const password = "correct-horse-battery-staple";

describe("master password credentials", () => {
  it("hashes and verifies the configured username and password", async () => {
    const configuration = await testConfiguration();

    await expect(verifyMasterCredentials("ANDA-ADMIN", password, configuration)).resolves.toBe(true);
    await expect(verifyMasterCredentials("another-admin", password, configuration)).resolves.toBe(false);
    await expect(verifyMasterCredentials("anda-admin", "wrong-password-value", configuration)).resolves.toBe(false);
    expect(configuration.passwordHash).not.toContain(password);
  });

  it("rejects weak generated passwords and malformed password hashes", async () => {
    expect(() => assertPasswordStrength("too-short")).toThrow(/14 characters/);
    const configuration = await testConfiguration();
    await expect(verifyMasterCredentials("anda-admin", password, {
      ...configuration,
      passwordHash: "not-a-password-hash",
    })).rejects.toThrow(/invalid/);
  });
});

describe("master session", () => {
  it("creates a signed, expiring session bound to the current credentials", async () => {
    const configuration = await testConfiguration();
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    const token = await createMasterSessionToken(configuration, now);

    await expect(verifyMasterSessionToken(token, configuration, now + 1_000)).resolves.toMatchObject({
      username: "anda-admin",
      issuedAt: Math.floor(now / 1_000),
    });
    await expect(verifyMasterSessionToken(token, configuration, now + 2 * 60 * 60 * 1_000)).resolves.toBeNull();
    await expect(verifyMasterSessionToken(token, {
      ...configuration,
      passwordHash: `${configuration.passwordHash}changed`,
    }, now + 1_000)).resolves.toBeNull();
  });

  it("fails closed on missing configuration and uses hardened cookies", () => {
    expect(() => getMasterAuthConfiguration({})).toThrow(MasterAuthConfigurationError);
    expect(masterSessionCookieOptions("production", 12)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 43_200,
      priority: "high",
    });
  });
});

describe("master login rate limiting", () => {
  it("blocks repeated failures and resets after the window or a success", () => {
    const limiter = new MasterLoginRateLimiter(1_000, 3);
    expect(limiter.recordFailure("client", 0).blocked).toBe(false);
    expect(limiter.recordFailure("client", 100).blocked).toBe(false);
    expect(limiter.recordFailure("client", 200)).toMatchObject({ blocked: true, retryAfterSeconds: 1 });
    expect(limiter.status("client", 1_001).blocked).toBe(false);
    limiter.recordFailure("client", 1_100);
    limiter.clear("client");
    expect(limiter.status("client", 1_100).blocked).toBe(false);
  });
});

async function testConfiguration(): Promise<MasterAuthConfiguration> {
  return {
    username: "anda-admin",
    passwordHash: await hashMasterPassword(password, {
      cost: 16_384,
      salt: Buffer.alloc(24, 7),
    }),
    sessionSecret: "test-session-secret-with-more-than-32-bytes",
    sessionHours: 1,
  };
}
