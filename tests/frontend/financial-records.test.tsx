// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialRecordsScreen } from "../../src/frontend/components/financials/FinancialRecordsScreen";
import {
  financialFolder,
  financialListResponse,
  financialRecord,
  pdfBytes,
} from "../helpers/financialFixtures";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

afterEach(() => {
  cleanup();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.unstubAllGlobals();
});

describe("Financial Records Library", () => {
  it("shows annual folders, monthly record groups and applies filters", async () => {
    const user = userEvent.setup();
    const fetchMock = financialFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<FinancialRecordsScreen />);

    expect(await screen.findByRole("heading", { name: "Financial records library" })).toBeTruthy();
    expect(await screen.findByText("August 2026")).toBeTruthy();
    expect((await screen.findAllByText("August operating statement")).length).toBeGreaterThan(0);
    const storedDocuments = screen.getByText("Stored documents").parentElement;
    expect(storedDocuments?.textContent).toContain("1");
    expect(storedDocuments?.textContent).not.toContain("B");
    expect(screen.getByRole("button", { name: /2026/u }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByText("YEAR")).toBeNull();
    const longFolder = screen.getByRole("button", { name: /Quarterly reporting and supporting documents/u });
    expect(longFolder.className).toContain("w-full");
    expect(longFolder.className).toContain("overflow-hidden");
    expect(longFolder.querySelector("span")?.className).toContain("truncate");

    await user.type(screen.getByLabelText("Record name"), "statement");
    await user.selectOptions(screen.getByLabelText("Financial month"), "8");
    await user.selectOptions(screen.getByLabelText("Records"), "archived");

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => {
      const value = String(url);
      return value.includes("q=statement") && value.includes("month=8") && value.includes("status=archived");
    })).toBe(true));
  });

  it("keeps the folder sidebar stable and confines delayed loading to the document container", async () => {
    const user = userEvent.setup();
    let resolve2025: ((response: Response) => void) | undefined;
    const pending2025 = new Promise<Response>((resolve) => { resolve2025 = resolve; });
    const folders = [
      financialFolder({ id: "20250000-0000-4000-8000-000000000025", name: "2025", sortOrder: 1 }),
      financialFolder(),
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/financials/folders") return Response.json({ folders });
      if (url.includes("folderId=20250000-0000-4000-8000-000000000025")) return pending2025;
      return Response.json(financialListResponse());
    }));
    renderWithQuery(<FinancialRecordsScreen />);

    const selected2026 = await screen.findByRole("button", { name: "2026" });
    await waitFor(() => expect(selected2026.getAttribute("aria-current")).toBe("page"));
    await screen.findByText("Active records");
    const sidebar = screen.getByLabelText("Financial folders");

    await user.click(screen.getByRole("button", { name: "2025" }));
    expect(screen.getByLabelText("Financial folders")).toBe(sidebar);
    expect(screen.getByRole("button", { name: "2025" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("status", { name: "Loading financial records" })).toBeNull();
    expect(screen.getByText("Active records")).toBeTruthy();

    const documents = screen.getByRole("region", { name: "Financial documents" });
    expect(await within(documents).findByRole("status", { name: "Loading financial records" })).toBeTruthy();
    resolve2025?.(Response.json(financialListResponse({ items: [], total: 0 })));
    await waitFor(() => expect(within(documents).queryByRole("status", { name: "Loading financial records" })).toBeNull());
  });

  it("uploads a financial file with month metadata", async () => {
    const user = userEvent.setup();
    const fetchMock = financialFetchMock();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<FinancialRecordsScreen />);
    await screen.findByRole("button", { name: /2026/u });
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload record" }).hasAttribute("disabled")).toBe(false));

    await user.click(screen.getByRole("button", { name: "Upload record" }));
    const dialog = screen.getByRole("dialog");
    const file = new File([pdfBytes()], "september-statement.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("File"), file);
    const nameInput = within(dialog).getByLabelText("Record name");
    await user.clear(nameInput);
    await user.type(nameInput, "September operating statement");
    await user.selectOptions(within(dialog).getByLabelText("Month"), "9");
    const submit = within(dialog).getByRole("button", { name: "Upload record" });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
    await user.click(submit);
    expect(toastError).not.toHaveBeenCalled();

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) => (
      String(url) === "/api/financials/records" && (options as RequestInit | undefined)?.method === "POST"
    ))).toBe(true));
    const uploadCall = fetchMock.mock.calls.find(([url, options]) => String(url) === "/api/financials/records" && (options as RequestInit | undefined)?.method === "POST");
    const form = uploadCall?.[1]?.body as FormData;
    expect(form.get("recordYear")).toBe("2026");
    expect(form.get("recordMonth")).toBe("9");
    expect(toastSuccess).toHaveBeenCalledWith("Financial record uploaded.");
  });
});

function financialFetchMock() {
  const folders = [
    financialFolder({ id: "20240000-0000-4000-8000-000000000024", name: "2024", sortOrder: 0 }),
    financialFolder({ id: "20250000-0000-4000-8000-000000000025", name: "2025", sortOrder: 1 }),
    financialFolder(),
    financialFolder({
      id: "22000000-0000-4000-8000-000000000002",
      name: "Quarterly reporting and supporting documents",
      isSystem: false,
      sortOrder: 3,
    }),
  ];
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/financials/folders") return Response.json({ folders });
    if (url === "/api/financials/records" && init?.method === "POST") return Response.json(financialRecord(), { status: 201 });
    if (url.startsWith("/api/financials/records")) return Response.json(financialListResponse());
    return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });
  });
}

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
