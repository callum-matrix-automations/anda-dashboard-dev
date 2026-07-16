import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { meetings } from "@/repositories/mock/fixtures";
import { MeetingTable } from "../MeetingTable";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("MeetingTable", () => {
  it("renders mobile cards with status-derived 44px actions", () => {
    const records = meetings.filter(({ status }) => ["PENDING_APPROVAL", "PDF_FAILED", "AWAITING_SIGNATURE"].includes(status));
    render(<MeetingTable meetings={records} signerAccess reviewAccess />);

    const cards = screen.getByRole("list", { name: "Meeting records" });
    expect(within(cards).getByRole("link", { name: "Review draft for June Board Meeting" })).toHaveClass("min-h-11", "w-full");
    expect(within(cards).getByRole("link", { name: /Resolve PDF failure/i })).toBeInTheDocument();
    expect(within(cards).getByRole("link", { name: /Sign document/i })).toBeInTheDocument();
  });

  it("preserves browse-all routing while retaining useful action labels", () => {
    const completed = meetings.find(({ status }) => status === "COMPLETED")!;
    const { rerender } = render(<MeetingTable meetings={[completed]} />);
    expect(screen.getAllByRole("link", { name: /View signed record/i })[0]).toHaveAttribute("href", `/app/archive/${completed.id}`);

    rerender(<MeetingTable meetings={[completed]} browseAll />);
    expect(screen.getAllByRole("link", { name: /View signed record/i })[0]).toHaveAttribute("href", `/app/meetings/${completed.id}`);
  });

  it("uses a read-safe label and route for signing-stage records without Treasurer access", () => {
    const signing = meetings.find(({ status }) => status === "AWAITING_SIGNATURE")!;
    render(<MeetingTable meetings={[signing]} browseAll />);
    expect(screen.getAllByRole("link", { name: `View record for ${signing.title}` })[0])
      .toHaveAttribute("href", `/app/meetings/${signing.id}`);
    expect(screen.queryByRole("link", { name: /Sign document/ })).not.toBeInTheDocument();
  });

  it("uses read-safe labels for Officer actions when the viewer is read-only", () => {
    const restricted = meetings.filter(({ status }) => ["AI_FAILED", "PENDING_APPROVAL", "PDF_FAILED"].includes(status));
    render(<MeetingTable meetings={restricted} browseAll />);
    expect(screen.getAllByRole("link", { name: /View record for/i })).toHaveLength(restricted.length * 2);
    expect(screen.queryByRole("link", { name: /Complete draft|Review draft|Resolve PDF failure/i })).not.toBeInTheDocument();
  });
});
