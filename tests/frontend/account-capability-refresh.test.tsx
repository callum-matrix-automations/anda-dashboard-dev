// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCurrentAccount } from "../../src/frontend/hooks/useApi";
const account = { profileId: "11111111-1111-4111-8111-111111111111", displayName: "Local President", role: "OFFICER", boardPosition: "PRESIDENT" };
vi.mock("@/frontend/api-client/client", () => ({ ApiClientError: class extends Error {}, apiClient: { account: { current: vi.fn() } } }));
afterEach(cleanup);
it("invalidates meeting capabilities when a refreshed account loses its President position", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  client.setQueryData(["current-account"], account);
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  renderHook(() => useCurrentAccount(), { wrapper });
  expect(invalidate).not.toHaveBeenCalled();
  act(() => client.setQueryData(["current-account"], { ...account, boardPosition: null }));
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["meeting"] }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["meetings"] });
  client.clear();
});
