import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/domain/types";
import { SigningWizard } from "../SigningWizard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const meeting: Meeting = {
  id: "mtg-2026-05-26",
  title: "May Board Meeting",
  category: "Board Meeting",
  date: "2026-05-26",
  status: "AWAITING_SIGNATURE",
  version: 6,
  deferredAt: null,
  deferredNote: null,
  failureReason: null,
  rejection: null,
  signedBy: null,
  signedAt: null,
  humanOwned: false,
  source: {
    provider: "Microsoft Teams",
    reference: "teams:19:meeting_may26board@thread.v2",
    importedAt: "2026-05-26T21:02:00Z",
    importStatus: "imported",
    participants: [],
  },
  analysisAttempt: 1,
  tags: ["Capital Works"],
  pdfArtifact: { name: "May Board Meeting — Minutes.pdf", version: 1, generatedAt: "2026-06-03T09:40:00Z", pageCount: 6, sizeLabel: "412 KB" },
  archivedAt: null,
  history: [],
  minutes: [{ id: "s1", heading: "Call to Order", body: "Quorum confirmed." }],
  attendees: [],
  motions: [],
  transcript: "transcript",
};

const noop = { busy: false, onSign: () => {}, onReject: () => {}, onCancel: () => {} };

describe("SigningWizard", () => {
  it("starts at meeting details with the immutable locked statement and full-record link", () => {
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} />);
    expect(screen.getByRole("heading", { name: /Confirm details/i })).toBeInTheDocument();
    expect(screen.getByText("May Board Meeting")).toBeInTheDocument();
    expect(screen.getByText(/locked and cannot change/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /full meeting record/i })).toHaveAttribute("href", "/app/meetings/mtg-2026-05-26");
  });

  it("requires explicit reviewed-version acknowledgement before reaching a signing decision", async () => {
    const onSign = vi.fn();
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} onSign={onSign} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Review document preview" })).toBeInTheDocument();
    expect(screen.getByText("May Board Meeting — Minutes.pdf")).toBeInTheDocument();
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(continueButton).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: "I reviewed version 1" }));
    expect(continueButton).toBeEnabled();
    await userEvent.click(continueButton);
    expect(screen.getByRole("heading", { name: /Decision/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Sign the minutes/i }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: /embedded signing/i })).toBeInTheDocument();
    expect(screen.getByText(/No external e-sign provider is contacted/i)).toBeInTheDocument();
    expect(onSign).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Record demo signature" }));
    expect(onSign).toHaveBeenCalledTimes(1);
  });

  it("requires a new acknowledgement when the artifact version changes while open", async () => {
    const { rerender } = render(<SigningWizard meeting={meeting} intent="sign" {...noop} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "I reviewed version 1" }));
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();

    rerender(
      <SigningWizard
        meeting={{ ...meeting, pdfArtifact: { ...meeting.pdfArtifact!, version: 2 } }}
        intent="sign"
        {...noop}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "I reviewed version 2" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("supports Back without losing the chosen decision", async () => {
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: /Confirm details/i })).toBeInTheDocument();
  });

  it("requires a comment before confirming a return for changes", async () => {
    const onReject = vi.fn();
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} onReject={onReject} />);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "I reviewed version 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("radio", { name: /Return for changes/i }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const confirm = screen.getByRole("button", { name: "Return for changes" });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("What must be corrected?"), "Vote tally for motion 5 is wrong.");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onReject).toHaveBeenCalledWith("Vote tally for motion 5 is wrong.");
  });

  it("opens directly at the rejection step and focuses the required comment for reject intent", () => {
    render(<SigningWizard meeting={meeting} intent="reject" {...noop} />);
    const comment = screen.getByRole("textbox", { name: "Rejection comment" });
    expect(comment).toHaveFocus();
    expect(comment).toBeRequired();
    expect(comment).toHaveAttribute("aria-required", "true");
    expect(comment).toHaveAccessibleDescription(/comment is required/i);
  });

  it("does not dismiss with Escape while a decision is being recorded", async () => {
    const onCancel = vi.fn();
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} busy onCancel={onCancel} />);

    await userEvent.keyboard("{Escape}");

    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Treasurer signing" })).toHaveAttribute("open");
  });

  it("cancel closes without signing or rejecting", async () => {
    const onCancel = vi.fn();
    const onSign = vi.fn();
    render(<SigningWizard meeting={meeting} intent="sign" {...noop} onCancel={onCancel} onSign={onSign} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSign).not.toHaveBeenCalled();
  });
});
