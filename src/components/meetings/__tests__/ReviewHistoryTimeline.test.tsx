import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReviewHistoryEntry } from "@/domain/types";
import { ReviewHistoryTimeline } from "../ReviewHistoryTimeline";

const history: ReviewHistoryEntry[] = [
  { id: "h1", actor: "System", action: "imported", at: "2026-06-30T21:05:00Z", note: "Transcript imported from Microsoft Teams." },
  { id: "h2", actor: "Daniel Okafor", action: "edit_saved", at: "2026-07-02T10:00:00Z", note: null },
  { id: "h3", actor: "Priya Raman", action: "rejected", at: "2026-07-03T09:00:00Z", note: "Vote tally is wrong." },
];

describe("ReviewHistoryTimeline", () => {
  it("renders every entry newest first with actor, action, and time", () => {
    render(<ReviewHistoryTimeline history={history} />);
    expect(screen.getByText(/Fixture history only.*no provider, AI, PDF, signature, or archive service events occurred/i)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Priya Raman");
    expect(items[0]).toHaveTextContent(/returned for changes/i);
    expect(items[2]).toHaveTextContent("System");
    expect(items[2]).toHaveTextContent(/imported/i);
  });

  it("shows optional notes only when present", () => {
    render(<ReviewHistoryTimeline history={history} />);
    expect(screen.getByText("Vote tally is wrong.")).toBeInTheDocument();
  });

  it("shows an empty state when there is no history", () => {
    render(<ReviewHistoryTimeline history={[]} />);
    expect(screen.getByText(/No review activity recorded yet/i)).toBeInTheDocument();
  });
});
