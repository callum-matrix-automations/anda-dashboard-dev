import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  MASTER_SESSION_COOKIE,
  createMasterSessionToken,
  getMasterAuthConfiguration,
} from "../../src/backend/auth/masterSession";
import { middleware } from "../../src/middleware";

const originalEnvironment = {
  username: process.env.MASTER_AUTH_USERNAME,
  password: process.env.MASTER_AUTH_PASSWORD,
};

beforeAll(() => {
  process.env.MASTER_AUTH_USERNAME = "anda-admin";
  process.env.MASTER_AUTH_PASSWORD = "correct-horse-battery-staple";
});

afterAll(() => {
  restoreEnvironment("MASTER_AUTH_USERNAME", originalEnvironment.username);
  restoreEnvironment("MASTER_AUTH_PASSWORD", originalEnvironment.password);
});

describe("master authentication middleware", () => {
  it("redirects protected pages and returns JSON for protected APIs", async () => {
    const pageResponse = await middleware(new NextRequest("https://anda.test/app/meetings?queue=review"));
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe(
      "https://anda.test/auth/sign-in?returnTo=%2Fapp%2Fmeetings%3Fqueue%3Dreview",
    );

    const apiResponse = await middleware(new NextRequest("https://anda.test/api/meetings"));
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("allows a valid session through and redirects an authenticated login page", async () => {
    const token = await createMasterSessionToken(getMasterAuthConfiguration());
    const headers = { cookie: `${MASTER_SESSION_COOKIE}=${token}` };
    const appResponse = await middleware(new NextRequest("https://anda.test/app/dashboard", { headers }));
    expect(appResponse.headers.get("x-middleware-next")).toBe("1");

    const signInResponse = await middleware(new NextRequest(
      "https://anda.test/auth/sign-in?returnTo=%2Fapp%2Farchive",
      { headers },
    ));
    expect(signInResponse.headers.get("location")).toBe("https://anda.test/app/archive");
  });

  it("leaves signed webhooks and internal bearer-token routes independent", async () => {
    const webhookResponse = await middleware(new NextRequest("https://anda.test/api/webhooks/firma"));
    const internalResponse = await middleware(new NextRequest("https://anda.test/api/internal/operations/recover"));
    expect(webhookResponse.headers.get("x-middleware-next")).toBe("1");
    expect(internalResponse.headers.get("x-middleware-next")).toBe("1");
  });
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
