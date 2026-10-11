// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterScreen } from "../../src/frontend/components/auth/RegisterScreen";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function fill(passwordAgain = "member-chosen-password") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Your name"), "Board Member");
  await user.type(screen.getByLabelText("Invited email address"), "member@example.test");
  await user.type(screen.getByLabelText("Invitation code"), "a".repeat(43));
  await user.type(screen.getByLabelText("Password (at least 12 characters)"), "member-chosen-password");
  await user.type(screen.getByLabelText("Enter your password again"), passwordAgain);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}
describe("member registration screen", () => {
  it("submits no roles and clearly offers sign in after creation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock); render(<RegisterScreen />); await fill();
    expect(await screen.findByRole("heading", { name: "Your account is ready" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in to your account" }).getAttribute("href")).toBe("/auth/sign-in");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ displayName: "Board Member", email: "member@example.test", password: "member-chosen-password", invitationCode: "a".repeat(43) });
  });
  it("requires matching passwords without calling the server", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); render(<RegisterScreen />); await fill("different-password");
    expect(screen.getByRole("alert").textContent).toContain("must match"); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows server invitation errors without claiming activation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Check your invitation." } }, { status: 400 })));
    render(<RegisterScreen />); await fill();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Check your invitation.");
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });
});
