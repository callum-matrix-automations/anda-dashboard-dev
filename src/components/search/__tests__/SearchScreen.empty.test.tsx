import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/search" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@/repositories/mock/repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repositories/mock/repositories")>();
  return {
    ...actual,
    createMockRepositories: (...args: Parameters<typeof actual.createMockRepositories>) => {
      const repositories = actual.createMockRepositories(...args);
      return {
        ...repositories,
        meetings: { ...repositories.meetings, list: async () => [] },
      };
    },
  };
});

describe("SearchScreen empty repository", () => {
  it("announces that no fixture meeting records are available before prompting for a query", async () => {
    render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);
    expect(await screen.findByRole("status")).toHaveTextContent("No fixture meeting records are available.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByText(/Type above to search/i)).not.toBeInTheDocument();
  });
});
