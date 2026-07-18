import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiClient } from "../../src/frontend/api-client/client";

afterEach(() => vi.unstubAllGlobals());

describe("frontend API client", () => {
  it("requests meeting queues through the API boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ meetings: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.meetings.list("needs-review")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/meetings?queue=needs-review",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
  });

  it("normalizes unavailable API responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(apiClient.meetings.list()).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        message: "The backend API is not available.",
        status: 404,
      }),
    );
  });
});
