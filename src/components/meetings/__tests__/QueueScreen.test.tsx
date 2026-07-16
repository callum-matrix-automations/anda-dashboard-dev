import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { meetings } from "@/repositories/mock/fixtures";
import { orderQueueMeetings } from "../QueueScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/archive" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("QueueScreen", () => {
  it("orders archive retrieval by archive/signing recency rather than meeting date", () => {
    const completed = meetings.find(({ status }) => status === "COMPLETED")!;
    const archivedLater = { ...completed, id: "later", date: "2026-01-01", archivedAt: "2026-07-10T09:00:00Z" };
    const meetingHeldLater = { ...completed, id: "earlier", date: "2026-06-01", archivedAt: "2026-07-01T09:00:00Z" };
    expect(orderQueueMeetings([meetingHeldLater, archivedLater], "archive").map(({ id }) => id))
      .toEqual(["later", "earlier"]);
  });

  it("shows a retrieval-specific empty state when archive search has no matches", async () => {
    render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);
    await userEvent.type(await screen.findByLabelText("Search signed records"), "no-such-signed-record");
    expect(await screen.findByText("No signed records match this search.")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs attention here.")).not.toBeInTheDocument();
  });
});
