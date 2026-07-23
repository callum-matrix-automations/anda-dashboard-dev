// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Navigation } from "../../src/frontend/components/navigation/Navigation";
import {
  applyTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
  type BoardTheme,
} from "../../src/frontend/components/shell/theme";

const workspace = vi.hoisted(() => ({
  avatar: null as string | null,
  theme: "board-light" as BoardTheme,
  setTheme: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/dashboard",
}));

vi.mock("@/frontend/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => workspace,
}));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  workspace.theme = "board-light";
  workspace.setTheme.mockReset();
});

afterEach(cleanup);

describe("ANDA theme", () => {
  it("uses light mode by default and honours a saved preference", () => {
    expect(resolveInitialTheme()).toBe("board-light");

    localStorage.setItem(THEME_STORAGE_KEY, "board-dark");
    expect(resolveInitialTheme()).toBe("board-dark");
  });

  it("applies and persists the selected theme", () => {
    applyTheme("board-dark");

    expect(document.documentElement.dataset.theme).toBe("board-dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("board-dark");
  });

  it("offers the opposite theme from the bottom of the navigation", async () => {
    const user = userEvent.setup();
    const rendered = render(<Navigation close={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(workspace.setTheme).toHaveBeenCalledWith("board-dark");

    workspace.theme = "board-dark";
    rendered.rerender(<Navigation close={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(workspace.setTheme).toHaveBeenLastCalledWith("board-light");
  });
});
