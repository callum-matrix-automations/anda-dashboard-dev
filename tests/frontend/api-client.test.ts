import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiClient } from "../../src/frontend/api-client/client";

const meetingId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.unstubAllGlobals());

describe("frontend API client", () => {
  it("parses the real paginated meeting queue response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.meetings.list({ queue: "needs-review" })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: meetingId, status: "PENDING_APPROVAL" })],
      total: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/meetings?queue=needs-review",
      expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
    );
  });

  it("parses source, transcript, participant, and generated draft detail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(detailResponse())));

    await expect(apiClient.meetings.get(meetingId)).resolves.toMatchObject({
      id: meetingId,
      transcript: { content: "Eleanor: The meeting is open." },
      sourceParticipants: [{ email: "eleanor@example.test", matchStatus: "matched" }],
      minutes: { summary: "The board opened the meeting." },
    });
  });

  it("sends encoded meeting searches through the paginated API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(listResponse()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.meetings.search("reserve fund", 10, 20)).resolves.toMatchObject({ total: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/meetings/search?q=reserve+fund&limit=10&offset=20",
      expect.any(Object),
    );
  });

  it("sends a versioned AI retry request and validates the mutation response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "analysis_retry_completed",
      meetingId,
      version: null,
      attempt: 1,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.meetings.retryAnalysis(meetingId, 4)).resolves.toMatchObject({
      action: "analysis_retry_completed",
      attempt: 1,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/analysis/retry`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ expectedVersion: 4 }) }),
    );
  });

  it("preserves backend error messages, codes, and conflict versions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: "version_conflict",
        message: "The meeting changed before this action completed.",
        currentVersion: 6,
      },
    }, 409)));

    await expect(apiClient.meetings.retryAnalysis(meetingId, 4)).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        message: "The meeting changed before this action completed.",
        status: 409,
        code: "version_conflict",
        currentVersion: 6,
      }),
    );
  });

  it("normalizes unavailable non-JSON API responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(apiClient.meetings.list()).rejects.toEqual(
      expect.objectContaining<ApiClientError>({
        name: "ApiClientError",
        message: "The backend API is not available.",
        status: 503,
      }),
    );
  });
});

function listResponse() {
  return { items: [summary()], total: 1, limit: 25, offset: 0 };
}

function summary() {
  return {
    id: meetingId,
    sourceMeetingId: "read_ai:session-1",
    title: "ANDA Board Meeting",
    category: "Board Meeting",
    meetingDate: "2026-07-21",
    durationMinutes: 60,
    status: "PENDING_APPROVAL",
    version: 4,
    deferredAt: null,
    deferredNote: null,
    humanOwned: false,
    failure: null,
    approval: null,
    pdfArtifact: null,
    pdfAttempt: 0,
    updatedAt: "2026-07-21T10:00:00.000Z",
    capabilities: {
      canEdit: true,
      canDefer: true,
      canResume: false,
      canMarkReady: false,
      canRetryAnalysis: false,
      canApprove: true,
      canRetryPdf: false,
      canOpenSigningSession: false,
      canRetrySigning: false,
      canRejectSigning: false,
      canRetrySigningOutcome: false,
      canDownloadArchive: false,
    },
  };
}

function detailResponse() {
  return {
    ...summary(),
    tags: ["governance"],
    minutes: {
      summary: "The board opened the meeting.",
      sections: [{ heading: "Opening", content: "The Chair opened the meeting." }],
    },
    transcript: {
      id: "33333333-3333-4333-8333-333333333333",
      sourceTranscriptId: "read_ai:session-1",
      content: "Eleanor: The meeting is open.",
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    source: {
      sourceMeetingId: "read_ai:session-1",
      startedAt: "2026-07-21T08:00:00.000Z",
      endedAt: "2026-07-21T09:00:00.000Z",
      durationMinutes: 60,
      importedAt: "2026-07-21T09:00:00.000Z",
    },
    sourceParticipants: [{
      displayName: "Eleanor Hughes",
      email: "eleanor@example.test",
      profileId,
      matchStatus: "matched",
    }],
    attendees: [{
      attendeeId: "44444444-4444-4444-8444-444444444444",
      profileId,
      displayName: "Eleanor Hughes",
    }],
    motions: [],
    history: [],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
