// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ComingSoonScreen } from "../../src/frontend/components/shared/ComingSoonScreen";

afterEach(cleanup);

describe("ComingSoonScreen", () => {
  it("renders a static Association placeholder", () => {
    render(<ComingSoonScreen area="Association" title="Financials" />);

    expect(screen.getByRole("heading", { name: "Coming soon" })).toBeTruthy();
    expect(screen.getByText("Association · Financials")).toBeTruthy();
    expect(screen.getByText(/not connected yet/i)).toBeTruthy();
  });

  it("renders the Accounts placeholder", () => {
    render(<ComingSoonScreen area="Administration" title="Account administration" />);

    expect(screen.getByText("Administration · Account administration")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Coming soon" })).toBeTruthy();
  });
});
