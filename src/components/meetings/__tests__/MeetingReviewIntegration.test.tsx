import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import type { Meeting } from "@/domain/types";

let pathname = "/app/meetings/mtg-2026-06-30";
const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const renderApp = () => render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);

function CacheProbe({ meetingId }: { meetingId: string }) {
  const client = useQueryClient();
  const [heading, setHeading] = useState("Not read");
  return (
    <>
      <button
        type="button"
        onClick={() => setHeading(client.getQueryData<Meeting>(["meeting", meetingId])?.minutes[0]?.heading ?? "Missing")}
      >
        Read cached heading
      </button>
      <output aria-label="Cached heading">{heading}</output>
    </>
  );
}

describe("meeting detail integration", () => {
  beforeEach(() => { localStorage.clear(); push.mockClear(); });

  it("shows the Meeting Source panel and the additive Summary/History tabs", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    expect(await screen.findByRole("heading", { name: "June Board Meeting" })).toBeInTheDocument();
    expect(screen.getByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Meeting section" })).toHaveValue("Minutes");
    // Pre-approval records have no generated document yet.
    expect(screen.queryByRole("tab", { name: "Document" })).not.toBeInTheDocument();
  });

  it("uses the compact mobile section selector without removing the full tab list", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    const selector = await screen.findByRole("combobox", { name: "Meeting section" });
    await userEvent.selectOptions(selector, "History");
    expect(await screen.findByRole("list", { name: "Review history" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  });

  it("lets an authorized viewer edit tags from the Summary tab before approval", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    await userEvent.click(await screen.findByRole("tab", { name: "Summary" }));
    expect((await screen.findAllByText(/Ready for officer approval/i)).length).toBeGreaterThanOrEqual(1);
    await userEvent.type(screen.getByLabelText("Add tag"), "Budget");
    await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(await screen.findByText("Budget")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove tag Budget" }));
    await waitFor(() => expect(screen.queryByText("Budget")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Remove tag Pool" })).toBeInTheDocument();
  });

  it("synchronizes saved content into the shared meeting cache", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    render(
      <WorkspaceProvider>
        <BoardApp />
        <CacheProbe meetingId="mtg-2026-06-30" />
      </WorkspaceProvider>,
    );
    await screen.findByRole("heading", { name: "June Board Meeting" });
    await userEvent.click(screen.getByText("More actions"));
    await userEvent.click(screen.getByRole("button", { name: "Edit minutes" }));
    const heading = await screen.findByRole("textbox", { name: "Minutes heading 1" });
    await userEvent.clear(heading);
    await userEvent.type(heading, "Updated call to order");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Meeting changes saved.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Read cached heading" }));
    expect(screen.getByLabelText("Cached heading")).toHaveTextContent("Updated call to order");
  });

  it("prioritizes approval, groups secondary actions, and restores trigger focus after Escape", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    const approve = await screen.findByRole("button", { name: "Approve" });
    expect(approve).toHaveClass("w-full", "min-h-11");
    expect(screen.getByText("More actions")).toBeInTheDocument();

    await userEvent.click(approve);
    const dialog = await screen.findByRole("dialog", { name: "approve meeting" });
    expect(dialog).toHaveTextContent(/locks this version from PDF processing onward/i);
    expect(dialog).toHaveTextContent(/Treasurer return for changes/i);
    expect(dialog).not.toHaveTextContent(/lock the record permanently/i);
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "approve meeting" })).not.toBeInTheDocument());
    expect(approve).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("describes approval as a local demo state change", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "approve meeting" })).toHaveAttribute("open");
    expect(await screen.findByRole("status")).toHaveTextContent(/Demo status changed to PDF processing/i);
    expect(screen.getByRole("status")).toHaveTextContent(/No PDF was generated/i);
  });

  it("keeps the defer dialog immutable and open while its mutation is pending", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    await userEvent.click(await screen.findByText("More actions"));
    await userEvent.click(screen.getByRole("button", { name: "Defer" }));
    const dialog = screen.getByRole("dialog", { name: "defer meeting" });
    const note = within(dialog).getByRole("textbox", { name: "Optional deferral note" });
    await userEvent.type(note, "Waiting for source clarification");
    await userEvent.click(within(dialog).getByRole("button", { name: "Defer" }));
    await waitFor(() => expect(note).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Defer" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "defer meeting" })).toHaveAttribute("open");
    expect(await screen.findByRole("status")).toHaveTextContent(/Demo meeting deferred in local state only/i);
    expect(await screen.findByRole("button", { name: "Resume Review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows the History timeline for the meeting", async () => {
    pathname = "/app/meetings/mtg-2026-06-30";
    renderApp();
    await userEvent.click(await screen.findByRole("tab", { name: "History" }));
    const timeline = await screen.findByRole("list", { name: "Review history" });
    expect(timeline).toHaveTextContent("Transcript imported");
    expect(timeline).toHaveTextContent("Automatic analysis completed");
  });

  it("offers Complete Manually but hides Mark Ready while the AI-failed draft is empty", async () => {
    pathname = "/app/meetings/mtg-2026-07-07";
    renderApp();
    expect(await screen.findByRole("button", { name: "Complete Manually" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Ready for Review" })).not.toBeInTheDocument();
    expect(screen.getByText(/all 3 automatic attempts exhausted/i)).toBeInTheDocument();
    await userEvent.click(screen.getByText("More actions"));
    expect(screen.getByRole("button", { name: "Retry Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report Issue" })).toBeInTheDocument();
  });

  it("opens the signing wizard from the Sign entry action", async () => {
    pathname = "/app/signing/mtg-2026-05-26";
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "Sign" }));
    expect(await screen.findByRole("heading", { name: /Confirm details/i })).toBeInTheDocument();
    expect(screen.getByText(/locked and cannot change/i)).toBeInTheDocument();
  });

  it("archive failure exposes no retry or report controls and states automatic recovery", async () => {
    pathname = "/app/signing/mtg-2026-04-28";
    renderApp();
    expect(await screen.findByRole("heading", { name: "April Board Meeting" })).toBeInTheDocument();
    expect(screen.getByText(/Recovery is automatic/i)).toBeInTheDocument();
    expect(screen.getByText(/demo signed state remains locked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report Issue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit minutes" })).not.toBeInTheDocument();
  });

  it("shows the signed document artifact on the completed archive record", async () => {
    pathname = "/app/archive/mtg-2026-03-24";
    renderApp();
    expect(await screen.findByText("Completed · Immutable")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview signed PDF" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Demo preview only.*no file was downloaded/i);
    await userEvent.click(screen.getByRole("tab", { name: "Document" }));
    expect(await screen.findByText("Annual General Meeting 2026 — Signed Minutes.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("Signed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Immutable archived record/i)).toBeInTheDocument();
    expect(screen.getByText(/superseded the unsigned artifact/i)).toBeInTheDocument();
  });
});
