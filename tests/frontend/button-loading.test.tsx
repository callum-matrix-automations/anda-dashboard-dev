// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../../src/frontend/components/design-system/primitives/button";

afterEach(cleanup);

describe("Button loading state", () => {
  it("shows a spinner and prevents repeat requests while loading", () => {
    render(<Button loading>Saving changes...</Button>);

    const button = screen.getByRole("button", { name: "Saving changes..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector("svg.animate-spin")).not.toBeNull();
  });
});
