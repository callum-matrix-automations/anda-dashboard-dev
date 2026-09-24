import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashMasterPassword } from "../../src/backend/auth/masterPassword";
import { POST as login } from "../../src/app/api/auth/login/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";

const originalEnvironment = {
  username: process.env.MASTER_AUTH_USERNAME,
  passwordHash: process.env.MASTER_AUTH_PASSWORD_HASH,
  sessionSecret: process.env.MASTER_AUTH_SESSION_SECRET,
  sessionHours: process.env.MASTER_AUTH_SESSION_HOURS,
};
const password = "correct-horse-battery-staple";

beforeAll(async () => {
  process.env.MASTER_AUTH_USERNAME = "anda-admin";
  process.env.MASTER_AUTH_PASSWORD_HASH = await hashMasterPassword(password, {
    cost: 16_384,
    salt: Buffer.alloc(24, 9),
  });
  process.env.MASTER_AUTH_SESSION_SECRET = "test-session-secret-with-more-than-32-bytes";
  process.env.MASTER_AUTH_SESSION_HOURS = "12";
});

afterAll(() => {
  restoreEnvironment("MASTER_AUTH_USERNAME", originalEnvironment.username);
  restoreEnvironment("MASTER_AUTH_PASSWORD_HASH", originalEnvironment.passwordHash);
  restoreEnvironment("MASTER_AUTH_SESSION_SECRET", originalEnvironment.sessionSecret);
  restoreEnvironment("MASTER_AUTH_SESSION_HOURS", originalEnvironment.sessionHours);
});

describe("master authentication routes", () => {
  it("sets a hardened session cookie for valid credentials", async () => {
    const response = await login(loginRequest("anda-admin", password, "198.51.100.1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("anda_master_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("correct-horse");
  });

  it("uses one generic error for an invalid username or password", async () => {
    const wrongUsername = await login(loginRequest("other-admin", password, "198.51.100.2"));
    const wrongPassword = await login(loginRequest("anda-admin", "wrong-password-value", "198.51.100.3"));

    expect(wrongUsername.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    await expect(wrongUsername.json()).resolves.toMatchObject({
      error: { code: "invalid_credentials", message: "The username or password is incorrect." },
    });
    await expect(wrongPassword.json()).resolves.toMatchObject({
      error: { code: "invalid_credentials", message: "The username or password is incorrect." },
    });
  });

  it("rejects cross-origin login and clears the cookie on logout", async () => {
    const crossOrigin = await login(new Request("https://anda.test/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.test" },
      body: JSON.stringify({ username: "anda-admin", password }),
    }));
    expect(crossOrigin.status).toBe(403);

    const response = await logout(new Request("https://anda.test/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://anda.test" },
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://anda.test/auth/sign-in");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function loginRequest(username: string, suppliedPassword: string, address: string) {
  return new Request("https://anda.test/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://anda.test",
      "x-forwarded-for": address,
    },
    body: JSON.stringify({ username, password: suppliedPassword }),
  });
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
