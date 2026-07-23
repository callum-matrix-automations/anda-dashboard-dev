// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMeeting, useMeetings } from "../../src/frontend/hooks/useApi";

const meetingId = "11111111-1111-4111-8111-111111111111";
const apiMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/frontend/api-client/client", () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiClient: {
    meetings: {
      list: apiMocks.list,
      get: apiMocks.get,
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.list.mockReset().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  apiMocks.get.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("meeting query refresh policy", () => {
  it("does not poll meeting lists or details on an interval", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      createElement(QueryClientProvider, { client: queryClient }, children)
    );

    renderHook(() => useMeetings(), { wrapper });
    renderHook(() => useMeeting(meetingId), { wrapper });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(apiMocks.list).toHaveBeenCalledTimes(1);
    expect(apiMocks.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(apiMocks.list).toHaveBeenCalledTimes(1);
    expect(apiMocks.get).toHaveBeenCalledTimes(1);
  });
});
