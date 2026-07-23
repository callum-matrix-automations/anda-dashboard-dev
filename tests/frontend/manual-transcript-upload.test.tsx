// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualTranscriptUploadDialog } from "../../src/frontend/components/dashboard/ManualTranscriptUploadDialog";

const meetingId = "11111111-1111-4111-8111-111111111111";
const routerPush = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

afterEach(() => {
  cleanup();
  routerPush.mockReset();
  vi.unstubAllGlobals();
});

describe("manual transcript upload dialog", () => {
  it("requires a title and transcript before making an API request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<ManualTranscriptUploadDialog />);

    await user.click(screen.getByRole("button", { name: "Upload transcript" }));
    await user.click(screen.getByRole("button", { name: "Begin processing" }));

    expect(screen.getByRole("alert").textContent).toContain("Enter a meeting title");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows processing state and opens the meeting after GPT analysis completes", async () => {
    const user = userEvent.setup();
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderWithQuery(<ManualTranscriptUploadDialog />);

    await user.click(screen.getByRole("button", { name: "Upload transcript" }));
    await user.type(screen.getByLabelText("Meeting title"), "Uploaded governance meeting");
    await user.type(
      screen.getByLabelText("Transcript"),
      "Eleanor Hughes: Welcome.\nMarcus Patel: I second the motion.",
    );
    await user.click(screen.getByRole("button", { name: "Begin processing" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((screen.getByRole("button", { name: "Processing transcript..." }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/keep this window open/i)).toBeTruthy();

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      title: "Uploaded governance meeting",
      durationMinutes: 60,
      transcript: "Eleanor Hughes: Welcome.\nMarcus Patel: I second the motion.",
    });
    expect(requestBody.meetingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

    resolveFetch(Response.json({
      status: "pending_approval",
      meetingId,
      analysisAttempt: 1,
    }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith(`/app/meetings/${meetingId}`));
  });
});

function renderWithQuery(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(createElement(QueryClientProvider, { client: queryClient }, node));
}
