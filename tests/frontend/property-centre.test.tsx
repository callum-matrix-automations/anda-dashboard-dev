// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyCentreScreen } from "../../src/frontend/components/properties/PropertyCentreScreen";
import { PropertyDetailScreen } from "../../src/frontend/components/properties/PropertyDetailScreen";
import { PropertyFormScreen } from "../../src/frontend/components/properties/PropertyFormScreen";
import { imageId, propertyDetail, propertyId, propertyListResponse } from "../helpers/propertyFixtures";

const { routerPush, toastSuccess, toastError } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.unstubAllGlobals();
});

describe("Property Centre overview", () => {
  it("renders inventory totals and sends address, type and status filters", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(Response.json(propertyListResponse("MULTIFAMILY")));
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<PropertyCentreScreen />);

    expect((await screen.findAllByText("4120 Mission Road, Kansas City, KS 66103")).length).toBeGreaterThan(0);
    expect(screen.getByText("Active properties").previousSibling?.textContent).toBe("3");
    expect(screen.getByText("Tracked units").previousSibling?.textContent).toBe("2");

    await user.type(screen.getByLabelText("Address or parcel"), "Mission");
    await user.selectOptions(screen.getByLabelText("Property type"), "MULTIFAMILY");
    await user.selectOptions(screen.getByLabelText("Inventory"), "archived");

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === (
      "/api/properties?q=Mission&type=MULTIFAMILY&status=archived&limit=25&offset=0"
    ))).toBe(true));
  });
});

describe("property form", () => {
  it("shows inline validation and enforces unique multifamily unit labels", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<PropertyFormScreen />);

    await user.selectOptions(screen.getByLabelText("Property type"), "MULTIFAMILY");
    await user.click(screen.getByRole("button", { name: "Add unit" }));
    await user.click(screen.getByRole("button", { name: "Add unit" }));
    const labels = screen.getAllByLabelText("Unit label");
    await user.type(labels[0]!, "A");
    await user.type(labels[1]!, "a");
    await user.click(screen.getByRole("button", { name: "Add property" }));

    expect(screen.getByText("Street address is required.")).toBeTruthy();
    expect(screen.getByText("Unit labels must be unique within a property.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("creates parcel-identified land and uploads selected images after saving", async () => {
    const user = userEvent.setup();
    const saved = propertyDetail("VACANT_LAND");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(saved, { status: 201 }))
      .mockResolvedValueOnce(Response.json({
        image: {
          id: imageId,
          fileName: "parcel.webp",
          mimeType: "image/webp",
          sizeBytes: 16,
          sortOrder: 0,
          createdBy: "10000000-0000-4000-8000-000000000003",
          createdAt: "2026-08-12T12:01:00.000Z",
          contentUrl: `/api/properties/${propertyId}/images/${imageId}`,
        },
        propertyVersion: 2,
      }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<PropertyFormScreen />);

    await user.selectOptions(screen.getByLabelText("Property type"), "VACANT_LAND");
    await user.type(screen.getByLabelText("Parcel reference"), "ANDA-LOT-021");
    const file = new File([new Uint8Array(16)], "parcel.webp", { type: "image/webp" });
    await user.upload(screen.getByLabelText("Add images"), file);
    await user.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/app/properties/${propertyId}`));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/properties");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/properties/${propertyId}/images`);
    const uploadOptions = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(uploadOptions.body).toBeInstanceOf(FormData);
    expect((uploadOptions.body as FormData).get("expectedVersion")).toBe("1");
    expect(toastSuccess).toHaveBeenCalledWith("Property added to the inventory.");
  });
});

describe("archived property detail", () => {
  it("restores the record while retaining its details and images", async () => {
    const user = userEvent.setup();
    const archived = propertyDetail("MULTIFAMILY", {
      version: 4,
      archivedAt: "2026-08-12T13:00:00.000Z",
    });
    const restored = { ...archived, version: 5, archivedAt: null, updatedAt: "2026-08-12T13:01:00.000Z" };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => (
      init?.method === "POST" ? Response.json(restored) : Response.json(archived)
    ));
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<PropertyDetailScreen propertyId={propertyId} />);

    expect(await screen.findByText("Archived")).toBeTruthy();
    expect(screen.getByText("2 individually tracked units.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Restore property" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/properties/${propertyId}/restore`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedVersion: 4 }) }),
    ));
    expect(toastSuccess).toHaveBeenCalledWith("Property restored to the active inventory.");
  });
});

function renderWithQuery(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
