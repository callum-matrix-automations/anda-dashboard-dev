import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveInitialTheme } from "../theme";

describe("theme storage fallbacks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses system preference when reading local storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    expect(resolveInitialTheme()).toBe("board-dark");
  });

  it("still applies a theme when persistence is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    expect(() => applyTheme("board-light")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("board-light");
  });
});
