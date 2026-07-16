import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/meetings/mtg-2026-06-30",
  useRouter: () => ({ push }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/repositories/mock/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repositories/mock/repositories")>();
  return {
    ...actual,
    createMockRepositories: (...args: Parameters<typeof actual.createMockRepositories>) =>
      actual.createMockRepositories({ ...args[0], conflictOnNextWrite: true }),
  };
});

describe("MeetingActions conflict recovery", () => {
  it("clears the persistent conflict after a refreshed retry succeeds", async () => {
    render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect((await screen.findAllByText(/local demo record was refreshed.*review the latest state and retry/i)).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Demo status changed to PDF processing/i));
    expect(screen.queryByRole("button", { name: "Dismiss" })).not.toBeInTheDocument();
  });
});
