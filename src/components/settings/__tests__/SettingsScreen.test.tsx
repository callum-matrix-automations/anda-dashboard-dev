import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BoardApp } from "@/components/BoardApp";
import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/settings" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const renderSettings = () => render(<WorkspaceProvider><BoardApp /></WorkspaceProvider>);
const pngFile = (bytes = 32) => {
  const content = new Uint8Array(bytes);
  content.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return new File([content], "avatar.png", { type: "image/png" });
};

describe("SettingsScreen", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "board-light";
    vi.stubGlobal("Image", class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
  });

  it("renders the settings route with demo-honest copy", async () => {
    renderSettings();
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/kept in memory for this demo session only/i)).toBeInTheDocument();
  });

  it("pins the current profile identity as the final sidebar link", async () => {
    renderSettings();
    const sidebar = await screen.findByRole("complementary");
    const links = within(sidebar).getAllByRole("link");
    const last = links[links.length - 1];
    expect(last).toHaveAccessibleName(/open profile settings/i);
    expect(last).toHaveAttribute("href", "/app/settings");
    expect(last).toHaveTextContent("PR");
    expect(last).toHaveTextContent("Priya Raman");
    expect(last).toHaveClass("min-h-14");
  });

  it("previews and removes an uploaded photo without adding a header icon", async () => {
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile());
    expect(await screen.findByAltText("Profile photo preview")).toBeInTheDocument();
    const sidebar = screen.getByRole("complementary");
    const profileLink = within(sidebar).getByRole("link", { name: /open profile settings/i });
    expect(profileLink.querySelector("img")).toBeInTheDocument();
    expect(profileLink).toHaveTextContent("Priya Raman");
    expect(profileLink).not.toHaveTextContent("PR");
    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(screen.queryByAltText("Profile photo preview")).not.toBeInTheDocument();
    expect(profileLink.querySelector("img")).not.toBeInTheDocument();
    expect(profileLink).toHaveTextContent("PR");
  });

  it("keeps photos per person and in memory only", async () => {
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile());
    await screen.findByAltText("Profile photo preview");
    expect(localStorage.getItem("board-theme")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("ANDA workspace role"), "o");
    expect(screen.queryByAltText("Profile photo preview")).not.toBeInTheDocument();
    const profileLink = within(screen.getByRole("complementary")).getByRole("link", { name: /open profile settings/i });
    expect(profileLink).toHaveTextContent("Daniel Okafor");
    expect(profileLink).toHaveTextContent("DO");
    expect(within(profileLink).queryByRole("img")).not.toBeInTheDocument();
  });

  it("rejects an unsupported file type with guidance", async () => {
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, new File(["hello"], "notes.txt", { type: "text/plain" }), { applyAccept: false });
    expect(await screen.findByText("Choose a PNG, JPEG, or WebP image.")).toBeInTheDocument();
    expect(screen.queryByAltText("Profile photo preview")).not.toBeInTheDocument();
  });

  it("rejects an oversized image with guidance", async () => {
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile(2 * 1024 * 1024 + 1));
    expect(await screen.findByText("Choose an image up to 2 MB.")).toBeInTheDocument();
  });

  it.each([
    ["empty", new File([], "empty.png", { type: "image/png" })],
    ["truncated", new File([new Uint8Array([137, 80, 78])], "short.png", { type: "image/png" })],
    ["random", new File([crypto.getRandomValues(new Uint8Array(32))], "random.png", { type: "image/png" })],
    ["mismatched", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "wrong.png", { type: "image/png" })],
  ])("rejects %s image bytes and preserves the previous avatar", async (_case, invalid) => {
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile());
    const previous = await screen.findByAltText("Profile photo preview");
    const source = previous.getAttribute("src");
    await userEvent.upload(input, invalid);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByAltText("Profile photo preview")).toHaveAttribute("src", source);
  });

  it("accepts the exact size boundary", async () => {
    renderSettings();
    await userEvent.upload(await screen.findByLabelText("Choose profile photo"), pngFile(2 * 1024 * 1024));
    expect(await screen.findByAltText("Profile photo preview")).toBeInTheDocument();
  });

  it("ignores a stale decode error after a newer upload succeeds", async () => {
    const images: Array<{ onload: null | (() => void); onerror: null | (() => void) }> = [];
    vi.stubGlobal("Image", class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      constructor() { images.push(this); }
      set src(_value: string) { /* Test controls completion order. */ }
    });
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile(32));
    await waitFor(() => expect(images).toHaveLength(1));
    await userEvent.upload(input, pngFile(33));
    await waitFor(() => expect(images).toHaveLength(2));
    images[1]!.onload?.();
    expect(await screen.findByAltText("Profile photo preview")).toBeInTheDocument();
    images[0]!.onerror?.();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores stale decode errors after removal and viewer switch", async () => {
    const images: Array<{ onload: null | (() => void); onerror: null | (() => void) }> = [];
    vi.stubGlobal("Image", class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      constructor() { images.push(this); }
      set src(_value: string) { /* Test controls completion order. */ }
    });
    renderSettings();
    const input = await screen.findByLabelText("Choose profile photo");
    await userEvent.upload(input, pngFile(32));
    await waitFor(() => expect(images).toHaveLength(1));
    images[0]!.onload?.();
    await screen.findByAltText("Profile photo preview");
    await userEvent.upload(input, pngFile(33));
    await waitFor(() => expect(images).toHaveLength(2));
    await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
    images[1]!.onerror?.();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByAltText("Profile photo preview")).not.toBeInTheDocument();

    await userEvent.upload(input, pngFile(34));
    await waitFor(() => expect(images).toHaveLength(3));
    await userEvent.selectOptions(screen.getByLabelText("ANDA workspace role"), "o");
    images[2]!.onerror?.();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switches the theme from appearance settings", async () => {
    renderSettings();
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("board-dark");
    expect(localStorage.getItem("board-theme")).toBe("board-dark");
    await userEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("board-light");
  });

  it("remains available to the internal superadmin without meeting access", async () => {
    renderSettings();
    await userEvent.selectOptions(await screen.findByLabelText("ANDA workspace role"), "s");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "All meetings" })).not.toBeInTheDocument();
  });
});
