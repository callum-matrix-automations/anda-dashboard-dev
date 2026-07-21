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

  it("loads an approved PDF preview as private, uncached binary data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("%PDF-1.7", {
      headers: { "content-type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pdf = await apiClient.meetings.previewPdf(meetingId);

    expect(await pdf.text()).toBe("%PDF-1.7");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/pdf/preview`,
      { cache: "no-store" },
    );
  });

  it("loads a Treasurer signing session and sends rejection and outcome recovery commands", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        meetingId,
        documentVersion: 4,
        providerStatus: "pending",
        recipientEmail: "treasurer@example.test",
        signingUrl: "https://app.firma.dev/signing/recipient-1",
      }))
      .mockResolvedValueOnce(jsonResponse({ action: "signing_rejected", meetingId, version: 7, documentVersion: 4 }))
      .mockResolvedValueOnce(jsonResponse({ action: "signing_outcome_retry_started", meetingId, version: 8, documentVersion: 4 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiClient.meetings.signingSession(meetingId)).resolves.toMatchObject({ providerStatus: "pending" });
    await apiClient.meetings.rejectSigning(meetingId, 6, "Correct the vote count.");
    await apiClient.meetings.retrySigningOutcome(meetingId, 7);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/meetings/${meetingId}/signing-session`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/meetings/${meetingId}/signing/reject`);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ body: JSON.stringify({ expectedVersion: 6, comment: "Correct the vote count." }) });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/meetings/${meetingId}/signing-outcome/retry`);
  });

  it("uses the real archive filters, detail, and temporary document-access APIs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [archiveListItem()], total: 1, limit: 10, offset: 0 }))
      .mockResolvedValueOnce(jsonResponse(archiveDetailResponse()))
      .mockResolvedValueOnce(jsonResponse({
        meetingId,
        pdfId: "55555555-5555-4555-8555-555555555555",
        url: "https://supabase.example.test/storage/signed.pdf?token=temporary",
        expiresAt: "2026-07-21T13:05:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await apiClient.archive.list({ query: "budget reserve", year: 2026, category: "Board Meeting", limit: 10, offset: 0 });
    await expect(apiClient.archive.get(meetingId)).resolves.toMatchObject({ meetingId, title: "ANDA Board Meeting" });
    await expect(apiClient.archive.documentAccess(meetingId)).resolves.toMatchObject({ meetingId });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/archive?q=budget+reserve&year=2026&category=Board+Meeting&limit=10&offset=0");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/archive/${meetingId}`);
    expect(fetchMock.mock.calls[2]?.[0]).toBe(`/api/archive/${meetingId}/document`);
  });

  it.each([
    ["resume", () => apiClient.meetings.resume(meetingId, 4), "POST", { expectedVersion: 4 }],
    ["ready", () => apiClient.meetings.markReady(meetingId, 4), "POST", { expectedVersion: 4 }],
    ["approve", () => apiClient.meetings.approve(meetingId, 4, true), "POST", { expectedVersion: 4, acknowledgeUnresolvedVotes: true }],
    ["pdf/retry", () => apiClient.meetings.retryPdf(meetingId, 4), "POST", { expectedVersion: 4 }],
    ["signing/retry", () => apiClient.meetings.retrySigning(meetingId, 4), "POST", { expectedVersion: 4 }],
  ] as const)("sends the %s meeting workflow mutation", async (path, call, method, body) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: path === "approve" ? "approved" : path === "ready" ? "marked_ready" : path === "resume" ? "resumed" : path === "pdf/retry" ? "pdf_retry_started" : "signing_retry_started",
      meetingId,
      version: 5,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await call();

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/meetings/${meetingId}/${path}`,
      expect.objectContaining({ method, body: JSON.stringify(body) }),
    );
  });

  it("sends complete draft and defer payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ action: "draft_saved", meetingId, version: 5 }))
      .mockResolvedValueOnce(jsonResponse({ action: "deferred", meetingId, version: 6 }));
    vi.stubGlobal("fetch", fetchMock);
    const draft = {
      minutes: { summary: "Updated.", sections: [{ heading: "Opening", content: "Opened." }] },
      attendeeProfileIds: [profileId],
      motions: [],
      tags: ["governance"],
    };

    await apiClient.meetings.saveDraft(meetingId, 4, draft);
    await apiClient.meetings.defer(meetingId, 5, "Awaiting evidence.");

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ expectedVersion: 4, draft }) });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ expectedVersion: 5, note: "Awaiting evidence." }) });
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

  it("preserves validation issues and unresolved-vote details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: {
        code: "unresolved_votes",
        message: "Approval requires acknowledgement.",
        unresolvedVoteCount: 2,
        issues: [{ path: "motions.0.votes", message: "Two votes remain unresolved." }],
      },
    }, 409)));

    await expect(apiClient.meetings.approve(meetingId, 4, false)).rejects.toEqual(
      expect.objectContaining({
        code: "unresolved_votes",
        unresolvedVoteCount: 2,
        issues: [{ path: "motions.0.votes", message: "Two votes remain unresolved." }],
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

function archiveListItem() {
  return {
    meetingId,
    title: "ANDA Board Meeting",
    meetingDate: "2026-07-21",
    category: "Board Meeting",
    tags: ["budget"],
    signedBy: profileId,
    signedAt: "2026-07-21T12:00:00.000Z",
    signedPdfId: "55555555-5555-4555-8555-555555555555",
    completedAt: "2026-07-21T12:01:00.000Z",
    version: 8,
  };
}

function archiveDetailResponse() {
  return {
    ...archiveListItem(),
    minutes: { summary: "The board approved the reserve.", sections: [{ heading: "Budget", content: "Approved." }] },
    motions: [{ id: "66666666-6666-4666-8666-666666666666", text: "Approve the reserve.", outcome: "CARRIED" }],
    document: {
      pdfId: "55555555-5555-4555-8555-555555555555",
      sha256: "a".repeat(64),
      sizeBytes: 12_000,
      pageCount: 3,
      documentVersion: 4,
    },
  };
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
    attendeeOptions: [{
      profileId,
      displayName: "Eleanor Hughes",
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
