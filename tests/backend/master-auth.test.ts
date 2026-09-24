import { describe, expect, it } from "vitest";
import { MasterLoginRateLimiter } from "../../src/backend/auth/masterLoginRateLimit";
import { verifyMasterCredentials } from "../../src/backend/auth/masterPassword";
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
  it("verifies the configured username and password", () => {
    const configuration = testConfiguration();

    expect(verifyMasterCredentials("ANDA-ADMIN", password, configuration)).toBe(true);
    expect(verifyMasterCredentials("another-admin", password, configuration)).toBe(false);
    expect(verifyMasterCredentials("anda-admin", "wrong-password-value", configuration)).toBe(false);
  });
});

describe("master session", () => {
  it("creates a signed, expiring session bound to the current credentials", async () => {
    const configuration = testConfiguration();
    const now = Date.UTC(2026, 8, 24, 12, 0, 0);
    const token = await createMasterSessionToken(configuration, now);

    await expect(verifyMasterSessionToken(token, configuration, now + 1_000)).resolves.toMatchObject({
      username: "anda-admin",
      issuedAt: Math.floor(now / 1_000),
    });
    await expect(verifyMasterSessionToken(token, configuration, now + 13 * 60 * 60 * 1_000)).resolves.toBeNull();
    await expect(verifyMasterSessionToken(token, {
      ...configuration,
      password: `${configuration.password}changed`,
    }, now + 1_000)).resolves.toBeNull();
  });

  it("fails closed on missing configuration and uses hardened cookies", () => {
    expect(() => getMasterAuthConfiguration({})).toThrow(MasterAuthConfigurationError);
    expect(masterSessionCookieOptions("production")).toMatchObject({
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

function testConfiguration(): MasterAuthConfiguration {
  return {
    username: "anda-admin",
    password,
  };
}
