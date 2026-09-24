// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MasterSignInScreen } from "../../src/frontend/components/auth/MasterSignInScreen";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({
  default: () => <span data-testid="logo" />,
}));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("master sign-in screen", () => {
  it("requires both fields before calling the server", async () => {
    render(<MasterSignInScreen returnTo="/app/dashboard" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Enter your username and password.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows the server's generic authentication failure", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      error: { code: "invalid_credentials", message: "The username or password is incorrect." },
    }, { status: 401 }));
    render(<MasterSignInScreen returnTo="/app/dashboard" />);

    await userEvent.type(screen.getByLabelText("Username"), "anda-admin");
    await userEvent.type(screen.getByLabelText("Password"), "incorrect-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain("The username or password is incorrect.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("continues to the requested dashboard route after successful login", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ok: true }));
    render(<MasterSignInScreen returnTo="/app/archive" />);

    await userEvent.type(screen.getByLabelText("Username"), "anda-admin");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse-battery-staple");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(fetch).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    expect(router.replace).toHaveBeenCalledWith("/app/archive");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("can reveal and hide the password", async () => {
    render(<MasterSignInScreen returnTo="/app/dashboard" />);
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("type")).toBe("password");
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(password.getAttribute("type")).toBe("text");
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(password.getAttribute("type")).toBe("password");
  });
});
