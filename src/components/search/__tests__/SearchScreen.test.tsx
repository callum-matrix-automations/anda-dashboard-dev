import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/search" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const renderSearch = () => render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);

describe("SearchScreen", () => {
  beforeEach(() => localStorage.clear());

  it("prompts for a query while Search is exposed through the header form", async () => {
    renderSearch();
    expect(await screen.findByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByText(/Search every meeting/)).toBeInTheDocument();
    expect(screen.getByRole("search")).toHaveAttribute("action", "/app/search");
    expect(screen.queryByRole("link", { name: "Search" })).not.toBeInTheDocument();
  });

  it("counts matches and links each hit to its record", async () => {
    renderSearch();
    await userEvent.type(await screen.findByLabelText("Search meetings and records"), "annual general");
    expect(await screen.findByText("1 result for “annual general”")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /View signed record for Annual General Meeting 2026/ });
    expect(link).toHaveAttribute("href", "/app/archive/mtg-2026-03-24");
    expect(link).toHaveClass("w-full", "min-h-11");
  });

  it("routes signing-stage hits to signing only for the treasurer", async () => {
    renderSearch();
    await userEvent.type(await screen.findByLabelText("Search meetings and records"), "May Board");
    expect(await screen.findByRole("link", { name: /Sign document for May Board Meeting/ }))
      .toHaveAttribute("href", "/app/signing/mtg-2026-05-26");

    await userEvent.selectOptions(screen.getByLabelText("ANDA workspace role"), "o");
    const input = await screen.findByLabelText("Search meetings and records");
    await userEvent.clear(input);
    await userEvent.type(input, "May Board");
    expect(await screen.findByRole("link", { name: /View record for May Board Meeting/ }))
      .toHaveAttribute("href", "/app/meetings/mtg-2026-05-26");
  });

  it("does not offer the removed User role in the simulator", async () => {
    renderSearch();
    await screen.findByLabelText("ANDA workspace role");
    expect(screen.queryByRole("option", { name: "user" })).not.toBeInTheDocument();
  });

  it("shows an explicit empty state when nothing matches", async () => {
    renderSearch();
    await userEvent.type(await screen.findByLabelText("Search meetings and records"), "zzz-no-such-topic");
    expect(await screen.findByText("No meetings match")).toBeInTheDocument();
    expect(screen.getByText(/Try a title, category, motion, or transcript phrase/)).toBeInTheDocument();
  });

  it("denies the internal superadmin", async () => {
    renderSearch();
    await userEvent.selectOptions(await screen.findByLabelText("ANDA workspace role"), "s");
    expect(screen.getByText("Superadmin is internal-only and has no meeting access.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Search meetings and records")).not.toBeInTheDocument();
  });
});
