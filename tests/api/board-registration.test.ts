import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/register/route";
import { registerBoardMember, BoardRegistrationError } from "../../src/backend/auth/registerBoardMember";
vi.mock("../../src/backend/auth/registerBoardMember", async original => ({ ...await original<typeof import("../../src/backend/auth/registerBoardMember")>(), registerBoardMember: vi.fn() }));
const valid = { email: "member@example.test", displayName: "Member", password: "member-chosen-password" };
function request(body: unknown, origin="https://anda.test") { return new Request("https://anda.test/api/auth/register", { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": crypto.randomUUID() }, body: JSON.stringify(body) }); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("registration endpoint", () => {
  it("registers without an invitation and returns success without creating a session", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test"); vi.mocked(registerBoardMember).mockResolvedValue({ ok: true });
    const result = await POST(request(valid));
    expect(result.status).toBe(201); expect(await result.json()).toEqual({ ok: true });
    expect(result.headers.get("set-cookie")).toBeNull(); expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("rejects cross-origin requests and privilege injection before admin calls", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test");
    expect((await POST(request(valid, "https://attacker.test"))).status).toBe(403);
    expect((await POST(request({ ...valid, role: "TREASURER" }))).status).toBe(400);
    expect(registerBoardMember).not.toHaveBeenCalled();
  });
  it("distinguishes failed registration from service outages without revealing arbitrary accounts", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test"); vi.mocked(registerBoardMember).mockRejectedValueOnce(new BoardRegistrationError()).mockRejectedValueOnce(new Error("private database details"));
    expect((await POST(request(valid))).status).toBe(400);
    const unavailable = await POST(request(valid)); expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("private database details");
  });
  it("validates name, email and password without suggesting an invitation", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test");
    const result = await POST(request({ ...valid, password: "short" }));
    expect(result.status).toBe(400);
    expect((await result.json()).error.message).not.toMatch(/invit/i);
    expect(registerBoardMember).not.toHaveBeenCalled();
  });
  it("limits repeated registrations before making more admin calls", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test"); vi.mocked(registerBoardMember).mockResolvedValue({ ok: true });
    const ip = crypto.randomUUID();
    const attempt = () => POST(new Request("https://anda.test/api/auth/register", { method: "POST", headers: {
      origin: "https://anda.test", "x-real-ip": ip,
    }, body: JSON.stringify(valid) }));
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(201);
    const blocked = await attempt();
    expect(blocked.status).toBe(429); expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(registerBoardMember).toHaveBeenCalledTimes(10);
  });
});
