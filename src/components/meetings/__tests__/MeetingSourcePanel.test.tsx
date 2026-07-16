import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MeetingSource } from "@/domain/types";
import { MeetingSourcePanel } from "../MeetingSourcePanel";

const source: MeetingSource = {
  provider: "Microsoft Teams",
  reference: "teams:19:meeting_jul14board@thread.v2",
  importedAt: "2026-07-14T21:12:00Z",
  importStatus: "imported",
  participants: [
    { id: "tp-01", displayName: "Priya Raman", matched: true, memberId: "mem-01", memberName: "Priya Raman" },
    { id: "tp-guest", displayName: "Dial-in caller (…4127)", matched: false, reason: "Phone dial-in with no Teams identity; speaker could not be matched to a member." },
  ],
};

describe("MeetingSourcePanel", () => {
  it("shows provider, reference, imported time, and import status", () => {
    render(<MeetingSourcePanel source={source} />);
    expect(screen.getByText("Microsoft Teams")).toBeInTheDocument();
    expect(screen.getByText("teams:19:meeting_jul14board@thread.v2")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
    expect(screen.getByText(/Fixture provenance only.*No Teams connection or transcript intake occurs/i)).toBeInTheDocument();
  });

  it("labels degraded import statuses distinctly", () => {
    render(<MeetingSourcePanel source={{ ...source, importStatus: "import_failed" }} />);
    expect(screen.getByText("Import failed")).toBeInTheDocument();
  });

  it("groups matched and unmatched participants separately", () => {
    render(<MeetingSourcePanel source={source} />);
    const matchedGroup = screen.getByRole("list", { name: /matched participants/i });
    const unmatchedGroup = screen.getByRole("list", { name: /unmatched speakers/i });
    expect(matchedGroup).toHaveTextContent("Priya Raman");
    expect(unmatchedGroup).toHaveTextContent("Dial-in caller (…4127)");
    expect(unmatchedGroup).toHaveTextContent(/could not be matched/);
  });

  it("summarizes unmatched speakers while collapsed and copies the safely wrapped reference", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MeetingSourcePanel source={source} />);
    expect(screen.getByText("1 unmatched speaker")).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Meeting Source/i));
    const reference = screen.getByText(source.reference);
    expect(reference).toHaveClass("select-all");
    await userEvent.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(writeText).toHaveBeenCalledWith(source.reference);
    expect(await screen.findByRole("status")).toHaveTextContent("Reference copied");
  });

  it("gives manual-copy guidance when clipboard access fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MeetingSourcePanel source={source} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Select the reference and copy it manually/i);
  });

  it("explains that unmatched speakers stay in the transcript but are excluded from structured records", () => {
    render(<MeetingSourcePanel source={source} />);
    expect(
      screen.getByText(/remain in the transcript but are excluded from structured attendance and voting until resolved/i),
    ).toBeInTheDocument();
  });

  it("handles a source with no participants", () => {
    render(<MeetingSourcePanel source={{ ...source, participants: [] }} />);
    expect(screen.getByText(/No participants were captured/i)).toBeInTheDocument();
  });
});
