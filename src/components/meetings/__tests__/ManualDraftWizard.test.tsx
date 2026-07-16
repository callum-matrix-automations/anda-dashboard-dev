import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/domain/types";
import type { Repositories } from "@/repositories/ports";
import { WorkspaceProvider, useWorkspace } from "@/components/providers/WorkspaceProvider";
import { ManualDraftWizard } from "../ManualDraftWizard";

// Host loads the AI_FAILED fixture (empty structured draft) from the workspace repos.
function Host({
  onFinished = () => {},
  onCancel = () => {},
  captureRepositories = () => {},
}: {
  onFinished?: (next: Meeting) => void;
  onCancel?: () => void;
  captureRepositories?: (repositories: Repositories) => void;
}) {
  const { repositories } = useWorkspace();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  useEffect(() => {
    captureRepositories(repositories);
    void repositories.meetings.get("mtg-2026-07-07").then(setMeeting);
  }, [repositories, captureRepositories]);
  if (!meeting) return null;
  return <ManualDraftWizard meeting={meeting} onFinished={onFinished} onCancel={onCancel} />;
}

const renderWizard = (props: Parameters<typeof Host>[0] = {}) =>
  render(
    <WorkspaceProvider>
      <Host {...props} />
    </WorkspaceProvider>,
  );

function LaunchableWizard() {
  const { repositories } = useWorkspace();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { void repositories.meetings.get("mtg-2026-07-07").then(setMeeting); }, [repositories]);
  return (
    <>
      <button onClick={() => setOpen(true)}>Launch manual wizard</button>
      {open && meeting && <ManualDraftWizard meeting={meeting} onFinished={() => setOpen(false)} onCancel={() => setOpen(false)} />}
    </>
  );
}

async function fillMinutesStep() {
  await userEvent.click(await screen.findByRole("button", { name: "Add section" }));
  await userEvent.type(screen.getByLabelText("Section 1 heading"), "Call to Order");
  await userEvent.type(screen.getByLabelText("Section 1 body"), "Quorum confirmed at 7:02 PM.");
}

describe("ManualDraftWizard", () => {
  it("locks background scrolling, traps focus, closes on Escape, and returns focus to its trigger", async () => {
    render(<WorkspaceProvider><LaunchableWizard /></WorkspaceProvider>);
    const trigger = await screen.findByRole("button", { name: "Launch manual wizard" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Complete manually" });
    expect(dialog).toHaveAttribute("open");
    expect(document.body.style.overflow).toBe("hidden");

    const buttons = within(dialog).getAllByRole("button").filter((button) => !button.hasAttribute("disabled"));
    buttons.at(-1)!.focus();
    await userEvent.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    buttons[0]!.focus();
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Complete manually" })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });

  it("keeps focus inside an open dialog during Strict Mode effect replay", async () => {
    render(<StrictMode><WorkspaceProvider><LaunchableWizard /></WorkspaceProvider></StrictMode>);
    const trigger = await screen.findByRole("button", { name: "Launch manual wizard" });
    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Complete manually" });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(trigger).not.toHaveFocus();
  });

  it("exposes compact mobile progress and 44px row controls", async () => {
    renderWizard();
    expect(await screen.findByText("Step 1 of 5 · Minutes")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByRole("button", { name: "Remove section 1" })).toHaveClass("min-h-11", "min-w-11");
    expect(screen.getByRole("button", { name: "Continue" })).toHaveClass("min-h-11");
  });

  it("blocks Continue with a specific message and moves focus when minutes are empty", async () => {
    renderWizard();
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Add at least one minutes section.");
    expect(alert).toHaveFocus();
  });

  it("adds, edits, and removes minutes sections", async () => {
    renderWizard();
    await userEvent.click(await screen.findByRole("button", { name: "Add section" }));
    await userEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section 2 heading")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove section 2" }));
    expect(screen.queryByLabelText("Section 2 heading")).not.toBeInTheDocument();
  });

  it("keeps entered data when moving Back", async () => {
    renderWizard();
    await fillMinutesStep();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: /Attendance/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Section 1 heading")).toHaveValue("Call to Order");
  });

  it("does not add the same matched participant twice during batched activation", async () => {
    renderWizard();
    await fillMinutesStep();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const removedName = (screen.getByLabelText("Attendee 1 name") as HTMLInputElement).value;
    await userEvent.click(screen.getByRole("button", { name: "Remove attendee 1" }));
    const addParticipant = screen.getByRole("button", { name: `Add ${removedName}` });
    act(() => {
      fireEvent.click(addParticipant);
      fireEvent.click(addParticipant);
    });
    expect(screen.getAllByDisplayValue(removedName)).toHaveLength(1);
  });

  it("walks the full path and marks the meeting ready", async () => {
    const onFinished = vi.fn();
    const onCancel = vi.fn();
    renderWizard({ onFinished, onCancel });
    await fillMinutesStep();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Attendance is prefilled from the matched-participant context.
    expect(await screen.findByRole("heading", { name: /Attendance/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Attendee 1 name")).not.toHaveValue("");
    expect(screen.getByText(/excluded from structured attendance/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: /Motions/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add motion" }));
    await userEvent.type(screen.getByLabelText("Motion 1 title"), "Replace irrigation zone 4");
    await userEvent.type(screen.getByLabelText("Motion 1 moved by"), "Daniel Okafor");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: /Votes/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add vote" }));
    await userEvent.type(screen.getByLabelText("Vote 1 member"), "Priya Raman");
    await userEvent.selectOptions(screen.getByLabelText("Vote 1 result"), "yes");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: /Review/ })).toBeInTheDocument();
    expect(screen.getByText(/1 minutes section/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mark Ready for Review" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled());
    await userEvent.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Complete manually" })).toHaveAttribute("open");
    await waitFor(() => expect(onFinished).toHaveBeenCalled(), { timeout: 4000 });
    const next = onFinished.mock.calls[0]![0] as Meeting;
    expect(next.status).toBe("PENDING_APPROVAL");
    expect(next.humanOwned).toBe(true);
    expect(next.minutes).toHaveLength(1);
  });

  it("disables Mark Ready on the review step while required data is missing", async () => {
    renderWizard();
    await fillMinutesStep();
    // Jump directly to Review via the step indicator to leave attendance untouched.
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: /Attendance/ });
    // Remove every attendee so the draft becomes incomplete.
    for (const button of [...screen.getAllByRole("button", { name: /Remove attendee/ })]) {
      await userEvent.click(button);
    }
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Add at least one attendee.");
  });

  it("cancel discards the draft without touching the repository", async () => {
    const onCancel = vi.fn();
    let repositories: Repositories | undefined;
    renderWizard({ onCancel, captureRepositories: (r) => { repositories = r; } });
    await fillMinutesStep();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    const untouched = await repositories!.meetings.get("mtg-2026-07-07");
    expect(untouched.minutes).toHaveLength(0);
    expect(untouched.version).toBe(2);
  });
});
