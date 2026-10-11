import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/register/route";
import { registerBoardMember, BoardRegistrationError } from "../../src/backend/auth/registerBoardMember";
vi.mock("../../src/backend/auth/registerBoardMember", async original => ({ ...await original<typeof import("../../src/backend/auth/registerBoardMember")>(), registerBoardMember: vi.fn() }));
const valid = { email: "member@example.test", displayName: "Member", password: "member-chosen-password", invitationCode: "a".repeat(43) };
function request(body: unknown, origin="https://anda.test") { return new Request("https://anda.test/api/auth/register", { method: "POST", headers: { origin, "content-type": "application/json", "x-real-ip": crypto.randomUUID() }, body: JSON.stringify(body) }); }
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
describe("registration endpoint", () => {
  it("returns success without creating a session or exposing private invitation data", async () => {
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
  it("distinguishes invalid invitations from service outages without revealing arbitrary accounts", async () => {
    vi.stubEnv("APP_ORIGIN", "https://anda.test"); vi.mocked(registerBoardMember).mockRejectedValueOnce(new BoardRegistrationError()).mockRejectedValueOnce(new Error("private database details"));
    expect((await POST(request(valid))).status).toBe(400);
    const unavailable = await POST(request(valid)); expect(unavailable.status).toBe(503);
    expect(JSON.stringify(await unavailable.json())).not.toContain("private database details");
  });
});
