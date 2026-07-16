import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagsEditor } from "../TagsEditor";

describe("TagsEditor", () => {
  it("renders existing tags", () => {
    render(<TagsEditor tags={["Pool", "Contracts"]} editable={false} busy={false} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText("Pool")).toBeInTheDocument();
    expect(screen.getByText("Contracts")).toBeInTheDocument();
  });

  it("adds a trimmed tag and clears the input", async () => {
    const onAdd = vi.fn();
    render(<TagsEditor tags={[]} editable busy={false} onAdd={onAdd} onRemove={() => {}} />);
    const input = screen.getByLabelText("Add tag");
    await userEvent.type(input, "  Budget  ");
    await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(onAdd).toHaveBeenCalledWith("Budget");
  });

  it("ignores blank submissions", async () => {
    const onAdd = vi.fn();
    render(<TagsEditor tags={[]} editable busy={false} onAdd={onAdd} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("removes a tag through its labelled control", async () => {
    const onRemove = vi.fn();
    render(<TagsEditor tags={["Pool"]} editable busy={false} onAdd={() => {}} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove tag Pool" }));
    expect(onRemove).toHaveBeenCalledWith("Pool");
  });

  it("is read-only when not editable: no input or remove controls", () => {
    render(<TagsEditor tags={["Pool"]} editable={false} busy={false} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.queryByLabelText("Add tag")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove tag/ })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only after approval/i)).toBeInTheDocument();
  });

  it("shows an explicit empty state when no tags exist", () => {
    render(<TagsEditor tags={[]} editable={false} busy={false} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/No tags/i)).toBeInTheDocument();
  });

  it("blocks keyboard and pointer additions while a write is busy", async () => {
    const onAdd = vi.fn();
    render(<TagsEditor tags={[]} editable busy onAdd={onAdd} onRemove={() => {}} />);
    const input = screen.getByLabelText("Add tag");
    expect(input).toBeDisabled();
    await userEvent.type(input, "Budget{enter}");
    await userEvent.click(screen.getByRole("button", { name: "Add tag" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("explains and blocks additions after the maximum tag count", () => {
    const tags = Array.from({ length: 20 }, (_, index) => `Tag ${index + 1}`);
    render(<TagsEditor tags={tags} editable busy={false} onAdd={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText("Add tag")).toBeDisabled();
    expect(screen.getByText(/maximum of 20 tags/i)).toBeInTheDocument();
  });
});
