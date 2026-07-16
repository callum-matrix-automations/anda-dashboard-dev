import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

let pathname = "/app/dashboard";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const renderApp = () => render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);

describe("dashboard clickable placeholders", () => {
  beforeEach(() => {
    pathname = "/app/dashboard";
    localStorage.clear();
  });

  it("turns every metric into a role-safe link for board roles", async () => {
    renderApp();
    await screen.findByText("Good morning, Priya");
    expect(screen.getByRole("link", { name: /Open meetings/ })).toHaveAttribute("href", "/app/meetings");
    expect(screen.getByRole("link", { name: /Pending approval/ })).toHaveAttribute("href", "/app/needs-review");
    expect(screen.getByRole("link", { name: /Signature and archive queue/ })).toHaveAttribute("href", "/app/signing");
    expect(screen.getByRole("link", { name: /Exceptions/ })).toHaveAttribute("href", "/app/meetings");
  });

  it("does not offer the removed User role in the simulator", async () => {
    renderApp();
    const simulator = await screen.findByLabelText("ANDA workspace role");
    expect(simulator).not.toContainHTML('value="u"');
    expect(screen.queryByRole("option", { name: "user" })).not.toBeInTheDocument();
  });

  it("labels metrics as fixture-derived and exposes the time series and progress values", async () => {
    renderApp();
    await screen.findByText("Good morning, Priya");
    expect(screen.getByText(/All values come from local demo fixtures.*no live services or durable archive/i)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Completed fixture records by archive month.*Apr 26: 1.*Jul 26: 0/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /On-track fixture records/i })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Exception fixture records/i })).toBeInTheDocument();
  });

  it("links the archive badge and both report explainers", async () => {
    renderApp();
    await screen.findByText("Good morning, Priya");
    expect(screen.getByRole("link", { name: /archived/ })).toHaveAttribute("href", "/app/archive");
    expect(screen.getByRole("link", { name: "How throughput is measured" })).toHaveAttribute("href", "/app/reports/throughput");
    expect(screen.getByRole("link", { name: "How lifecycle health is measured" })).toHaveAttribute("href", "/app/reports/lifecycle");
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/app/meetings");
  });

  it("renders a concrete placeholder for the throughput report", async () => {
    pathname = "/app/reports/throughput";
    renderApp();
    expect(await screen.findByRole("heading", { name: "Meeting throughput report" })).toBeInTheDocument();
    expect(screen.getByText(/In production, this page would/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute("href", "/app/dashboard");
  });

  it("denies reports to the internal superadmin", async () => {
    pathname = "/app/reports/lifecycle";
    renderApp();
    await userEvent.selectOptions(await screen.findByLabelText("ANDA workspace role"), "s");
    expect(screen.getByText("Superadmin is internal-only and has no meeting access.")).toBeInTheDocument();
  });
});
