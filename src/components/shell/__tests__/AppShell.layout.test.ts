import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\s+/g, " ");

describe("AppShell layout contract", () => {
  it("fills the viewport edge-to-edge while preserving isolated content scrolling", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toContain("body{min-height:100vh;min-height:100dvh;margin:0;overflow:hidden");
    expect(css).toContain(".app-frame{height:100vh;height:100dvh;min-width:0;overflow:hidden}");
    expect(css).toContain(".app-frame>.drawer-content{height:100%;min-width:0;overflow-x:hidden;overflow-y:auto}");
    expect(css).toContain(".app-frame>.drawer-side{height:100%;overflow-y:auto}");
    expect(css).not.toContain("calc(100vh - 1.5rem)");
    expect(css).not.toMatch(/\.app-frame\{[^}]*?(?:margin|border-radius|box-shadow):/);
  });

  it("allows main content to use the full responsive drawer width", () => {
    const shell = readSource("src/components/shell/AppShell.tsx");

    expect(shell).toContain('<main className="w-full min-w-0 p-4 sm:p-6 lg:p-8">');
    expect(shell).not.toContain("max-w-[1500px]");
    expect(shell).not.toContain("mx-auto");
  });

  it("keeps the top bar compact without shrinking its touch-safe controls", () => {
    const shell = readSource("src/components/shell/AppShell.tsx");

    // AIDEV-NOTE: These tokens encode 60px desktop and 112px phone bars around 44px controls.
    expect(shell).toMatch(/<header className="[^"]*\bmin-h-0\b[^"]*\bgap-2\b[^"]*\bpy-2\b[^"]*">/);
    expect(shell).not.toMatch(/<header className="[^"]*\blg:py-(?:3|4)\b/);
    expect(shell).toMatch(/role="search" className="[^"]*\brow-start-2\b[^"]*\blg:row-start-1\b/);
    expect(shell).toContain('className="input input-bordered flex min-h-11 w-full items-center gap-2"');
    expect(shell).toContain('className="select select-bordered select-sm min-h-11 w-full"');
    expect(shell).toContain('className="btn btn-ghost btn-square size-11 lg:hidden"');
  });

  it("makes links and controls visibly interactive before hover", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toContain("a[href],button:not(:disabled),summary,select{cursor:pointer}");
    expect(css).toContain(".link{font-weight:600;text-decoration-thickness:1.5px;text-underline-offset:3px}");
    expect(css).toContain(".btn-ghost{border-color:");
    expect(css).toContain(".menu a:not(.menu-active){border-color:");
  });
});
