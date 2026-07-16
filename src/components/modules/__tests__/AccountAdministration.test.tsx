import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

const inviteFailure = vi.hoisted(() => ({ message: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/members" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/repositories/mock/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repositories/mock/repositories")>();
  return { ...actual, createMockRepositories: (...args: Parameters<typeof actual.createMockRepositories>) => {
    const repositories = actual.createMockRepositories(...args);
    const invite = repositories.members.invite;
    repositories.members.invite = (email) => inviteFailure.message ? Promise.reject(new Error(inviteFailure.message)) : invite(email);
    return repositories;
  } };
});

describe("AccountAdministration invitations", () => {
  beforeEach(() => { localStorage.clear(); inviteFailure.message = ""; });
  const open = async () => {
    render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);
    await userEvent.selectOptions(await screen.findByLabelText("ANDA workspace role"), "a");
    await userEvent.click(await screen.findByRole("button", { name: "Invite account" }));
  };

  it.each(["", "   ", "malformed", `${"a".repeat(245)}@example.com`])("keeps the dialog open with an accessible error for %j", async (email) => {
    await open();
    const input = screen.getByRole("textbox", { name: "Email" });
    if (email) fireEvent.change(input, { target: { value: email } });
    await userEvent.click(screen.getByRole("button", { name: "Prepare invitation" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Invite account" })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("closes only after a valid invitation succeeds", async () => {
    await open();
    await userEvent.type(screen.getByRole("textbox", { name: "Email" }), "member@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Prepare invitation" }));
    expect(await screen.findByText("Account invitation prepared.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Invite account" })).not.toBeInTheDocument();
  });

  it("shows mutation failures and keeps entered email available", async () => {
    inviteFailure.message = "Invitation service unavailable.";
    await open();
    const input = screen.getByRole("textbox", { name: "Email" });
    await userEvent.type(input, "member@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Prepare invitation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation service unavailable.");
    expect(input).toHaveValue("member@example.com");
  });
});
