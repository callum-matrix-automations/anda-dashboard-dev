import { describe, expect, it, vi } from "vitest";
import {
  createApproveMeetingHandler,
  createDeferMeetingHandler,
  createMarkMeetingReadyHandler,
  createMeetingDetailHandler,
  createMeetingListHandler,
  createMeetingSearchHandler,
  createMeetingSigningSessionHandler,
  createRejectMeetingSigningHandler,
  createResumeMeetingHandler,
  createRetryMeetingAnalysisHandler,
  createRetryMeetingPdfHandler,
  createRetryMeetingSigningHandler,
  createRetryMeetingSigningOutcomeHandler,
  createSaveMeetingDraftHandler,
} from "../../src/backend/integrations/meetings/meetingApiHandlers";

const meetingId = "11111111-1111-4111-8111-111111111111";
const officerId = "22222222-2222-4222-8222-222222222222";
const treasurerId = "33333333-3333-4333-8333-333333333333";
const attendeeId = "44444444-4444-4444-8444-444444444444";

const userResolver = vi.fn().mockResolvedValue({
  profileId: attendeeId,
  displayName: "General Member",
  role: "USER" as const,
  isAdmin: false,
});
const officerResolver = vi.fn().mockResolvedValue({
  profileId: officerId,
  displayName: "Board Officer",
  role: "OFFICER" as const,
  isAdmin: false,
});
const treasurerResolver = vi.fn().mockResolvedValue({
  profileId: treasurerId,
  displayName: "Treasurer",
  role: "TREASURER" as const,
  isAdmin: false,
});

describe("meeting controller authentication and reads", () => {
  it("requires server-resolved authentication on every public meeting route", async () => {
    const services = servicesMock();
    const options = { services, actorResolver: vi.fn().mockResolvedValue(null) };
    const routeCalls = [
      () => createMeetingListHandler(options)(request("/api/meetings")),
      () => createMeetingSearchHandler(options)(request("/api/meetings/search?q=board")),
      () => createMeetingDetailHandler(options)(request(`/api/meetings/${meetingId}`), context(meetingId)),
      () => createSaveMeetingDraftHandler(options)(jsonRequest(`/api/meetings/${meetingId}/draft`, "PATCH", {
        expectedVersion: 4,
        draft: validDraft(),
      }), context(meetingId)),
      () => createDeferMeetingHandler(options)(versionedRequest("defer"), context(meetingId)),
      () => createResumeMeetingHandler(options)(versionedRequest("resume"), context(meetingId)),
      () => createMarkMeetingReadyHandler(options)(versionedRequest("ready"), context(meetingId)),
      () => createRetryMeetingAnalysisHandler(options)(versionedRequest("analysis/retry"), context(meetingId)),
      () => createApproveMeetingHandler(options)(versionedRequest("approve"), context(meetingId)),
      () => createRetryMeetingPdfHandler(options)(versionedRequest("pdf/retry"), context(meetingId)),
      () => createMeetingSigningSessionHandler(options)(request(`/api/meetings/${meetingId}/signing-session`), context(meetingId)),
      () => createRetryMeetingSigningHandler(options)(versionedRequest("signing/retry"), context(meetingId)),
      () => createRejectMeetingSigningHandler(options)(versionedRequest("signing/reject"), context(meetingId)),
      () => createRetryMeetingSigningOutcomeHandler(options)(versionedRequest("signing-outcome/retry"), context(meetingId)),
    ];

    for (const callRoute of routeCalls) {
      const response = await callRoute();
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "authentication_required" },
      });
    }
    expect(services.listMeetingReviews).not.toHaveBeenCalled();
    expect(services.getMeetingReview).not.toHaveBeenCalled();
    expect(services.saveMeetingDraft).not.toHaveBeenCalled();
  });

  it("fails closed for missing and unavailable authentication", async () => {
    const services = servicesMock();
    const unauthenticated = createMeetingListHandler({
      services,
      actorResolver: vi.fn().mockResolvedValue(null),
    });
    const unavailable = createMeetingListHandler({
      services,
      actorResolver: vi.fn().mockRejectedValue(new Error("Supabase unavailable")),
    });

    expect((await unauthenticated(request("/api/meetings"))).status).toBe(401);
    expect((await unavailable(request("/api/meetings"))).status).toBe(503);
    expect(services.listMeetingReviews).not.toHaveBeenCalled();
  });

  it("filters and paginates queues while returning actor-specific capabilities", async () => {
    const services = servicesMock();
    services.listMeetingReviews = vi.fn().mockResolvedValue([
      summary(),
      summary({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deferredAt: "2026-07-20T12:00:00.000Z" }),
      summary({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "AWAITING_SIGNATURE", version: 7 }),
    ]);
    const handler = createMeetingListHandler({ services, actorResolver: officerResolver });
    const response = await handler(request("/api/meetings?queue=needs-review&limit=1&offset=0"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(body.items[0].capabilities).toMatchObject({
      canEdit: true,
      canApprove: true,
      canOpenSigningSession: false,
    });
    expect(JSON.stringify(body)).not.toContain("storage/unsigned.pdf");
    expect(JSON.stringify(body)).not.toContain("a".repeat(64));
  });

  it("rejects unknown, repeated, and malformed query parameters", async () => {
    const services = servicesMock();
    const handler = createMeetingListHandler({ services, actorResolver: userResolver });

    expect((await handler(request("/api/meetings?unknown=yes"))).status).toBe(400);
    expect((await handler(request("/api/meetings?limit=1&limit=2"))).status).toBe(400);
    expect((await handler(request("/api/meetings?status=UNKNOWN"))).status).toBe(400);
    expect(services.listMeetingReviews).not.toHaveBeenCalled();
  });

  it("searches active fields and completed archive content without exposing archive records", async () => {
    const services = servicesMock();
    services.listMeetingReviews = vi.fn().mockResolvedValue([
      summary(),
      summary({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Annual planning", status: "COMPLETED" }),
    ]);
    services.searchArchive = vi.fn().mockResolvedValue({
      items: [{ meetingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    const handler = createMeetingSearchHandler({ services, actorResolver: userResolver });
    const response = await handler(request("/api/meetings/search?q=reserve"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(services.searchArchive).toHaveBeenCalledWith({ query: "reserve", limit: 100, offset: 0 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("returns a safe complete meeting detail and maps invalid or missing IDs", async () => {
    const services = servicesMock();
    services.getMeetingReview = vi.fn().mockResolvedValue(detail());
    const handler = createMeetingDetailHandler({ services, actorResolver: userResolver });
    const response = await handler(request(`/api/meetings/${meetingId}`), context(meetingId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.transcript.content).toContain("Meeting opened");
    expect(body.transcript.metadata).toBeUndefined();
    expect(body.category).toBe("Board Meeting");
    expect(body.source).toEqual({
      sourceMeetingId: "read-ai-meeting-1",
      startedAt: "2026-07-20T08:00:00.000Z",
      endedAt: "2026-07-20T09:30:00.000Z",
      durationMinutes: 90,
      importedAt: "2026-07-20T09:00:00.000Z",
    });
    expect(body.sourceParticipants).toEqual([
      {
        displayName: "General Member",
        email: "member@example.test",
        profileId: attendeeId,
        matchStatus: "matched",
      },
      {
        displayName: "Unmatched Guest",
        email: "guest@example.test",
        profileId: null,
        matchStatus: "unmatched",
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("must-not-leave-server");
    expect(body.pdfArtifact.path).toBeUndefined();
    expect((await handler(request("/api/meetings/not-valid"), context("not-valid"))).status).toBe(400);

    services.getMeetingReview = vi.fn().mockResolvedValue(null);
    expect((await handler(request(`/api/meetings/${meetingId}`), context(meetingId))).status).toBe(404);
  });
});

describe("meeting review and approval controllers", () => {
  it("does not accept actor identity from the client", async () => {
    const services = servicesMock();
    const handler = createSaveMeetingDraftHandler({ services, actorResolver: officerResolver });
    const response = await handler(jsonRequest(`/api/meetings/${meetingId}/draft`, "PATCH", {
      expectedVersion: 4,
      actorProfileId: treasurerId,
      draft: validDraft(),
    }), context(meetingId));

    expect(response.status).toBe(400);
    expect(services.saveMeetingDraft).not.toHaveBeenCalled();
  });

  it("injects the resolved officer and validates the complete draft", async () => {
    const services = servicesMock();
    const handler = createSaveMeetingDraftHandler({ services, actorResolver: officerResolver });
    const response = await handler(jsonRequest(`/api/meetings/${meetingId}/draft`, "PATCH", {
      expectedVersion: 4,
      draft: validDraft(),
    }), context(meetingId));

    expect(response.status).toBe(200);
    expect(services.saveMeetingDraft).toHaveBeenCalledWith({
      meetingId,
      expectedVersion: 4,
      actorProfileId: officerId,
      draft: validDraft(),
    });
    await expect(response.json()).resolves.toMatchObject({ action: "draft_saved", version: 5 });
  });

  it("blocks ordinary members before any review service call", async () => {
    const services = servicesMock();
    const handler = createResumeMeetingHandler({ services, actorResolver: userResolver });
    const response = await handler(jsonRequest(`/api/meetings/${meetingId}/resume`, "POST", {
      expectedVersion: 4,
    }), context(meetingId));

    expect(response.status).toBe(403);
    expect(services.resumeMeetingReview).not.toHaveBeenCalled();
  });

  it("exposes defer, resume, ready, approval, and PDF retry controller actions", async () => {
    const services = servicesMock();
    const options = { services, actorResolver: officerResolver };
    const cases = [
      [createDeferMeetingHandler(options), "defer", { expectedVersion: 4, note: "Awaiting records." }, "deferred"],
      [createResumeMeetingHandler(options), "resume", { expectedVersion: 4 }, "resumed"],
      [createMarkMeetingReadyHandler(options), "ready", { expectedVersion: 4 }, "marked_ready"],
      [createApproveMeetingHandler(options), "approve", { expectedVersion: 4, acknowledgeUnresolvedVotes: true }, "approved"],
      [createRetryMeetingPdfHandler(options), "pdf/retry", { expectedVersion: 4 }, "pdf_retry_started"],
    ] as const;

    for (const [handler, path, body, expectedAction] of cases) {
      const response = await handler(
        jsonRequest(`/api/meetings/${meetingId}/${path}`, "POST", body),
        context(meetingId),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ action: expectedAction, meetingId });
    }
    expect(services.approveMeeting).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: officerId }));
  });

  it("runs a versioned AI failure retry without accepting actor or provider input", async () => {
    const services = servicesMock();
    const handler = createRetryMeetingAnalysisHandler({ services, actorResolver: officerResolver });
    const response = await handler(jsonRequest(`/api/meetings/${meetingId}/analysis/retry`, "POST", {
      expectedVersion: 4,
    }), context(meetingId));

    expect(response.status).toBe(200);
    expect(services.retryMeetingAnalysis).toHaveBeenCalledWith({
      meetingId,
      expectedVersion: 4,
      actorProfileId: officerId,
    });
    await expect(response.json()).resolves.toEqual({
      action: "analysis_retry_completed",
      meetingId,
      version: null,
      attempt: 1,
    });

    const injected = await handler(jsonRequest(`/api/meetings/${meetingId}/analysis/retry`, "POST", {
      expectedVersion: 4,
      actorProfileId: treasurerId,
      transcript: "replacement transcript",
      model: "replacement-model",
    }), context(meetingId));
    expect(injected.status).toBe(400);
    expect(services.retryMeetingAnalysis).toHaveBeenCalledTimes(1);
  });

  it("authorizes and safely maps AI retry conflicts, invalid states, and failures", async () => {
    const services = servicesMock();
    const memberHandler = createRetryMeetingAnalysisHandler({ services, actorResolver: userResolver });
    expect((await memberHandler(versionedRequest("analysis/retry"), context(meetingId))).status).toBe(403);
    expect(services.retryMeetingAnalysis).not.toHaveBeenCalled();

    services.retryMeetingAnalysis = vi.fn()
      .mockResolvedValueOnce({ status: "conflict", meetingId, version: 8, attempt: null })
      .mockResolvedValueOnce({ status: "invalid_state", meetingId, version: 8, attempt: null })
      .mockResolvedValueOnce({ status: "failed", meetingId, version: null, attempt: 3 });
    const officerHandler = createRetryMeetingAnalysisHandler({ services, actorResolver: officerResolver });

    const conflict = await officerHandler(versionedRequest("analysis/retry"), context(meetingId));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "version_conflict", currentVersion: 8 },
    });
    expect((await officerHandler(versionedRequest("analysis/retry"), context(meetingId))).status).toBe(409);
    const failed = await officerHandler(versionedRequest("analysis/retry"), context(meetingId));
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "workflow_action_failed" },
    });
  });

  it("maps optimistic conflicts and content failures to stable error envelopes", async () => {
    const services = servicesMock();
    services.approveMeeting = vi.fn()
      .mockResolvedValueOnce({
        status: "conflict",
        meetingId,
        version: 9,
        unresolvedVoteCount: 0,
        documentVersion: null,
      })
      .mockResolvedValueOnce({
        status: "invalid_content",
        meetingId,
        version: 9,
        unresolvedVoteCount: 0,
        documentVersion: null,
      });
    const handler = createApproveMeetingHandler({ services, actorResolver: officerResolver });
    const approval = () => handler(jsonRequest(`/api/meetings/${meetingId}/approve`, "POST", {
      expectedVersion: 4,
      acknowledgeUnresolvedVotes: true,
    }), context(meetingId));

    const conflict = await approval();
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: {
        code: "version_conflict",
        message: "Meeting changed after it was loaded.",
        currentVersion: 9,
        unresolvedVoteCount: 0,
      },
    });
    expect((await approval()).status).toBe(422);
  });
});

describe("meeting signing controllers", () => {
  it("requires the Treasurer for signing routes", async () => {
    const services = servicesMock();
    const handler = createMeetingSigningSessionHandler({ services, actorResolver: officerResolver });
    const response = await handler(request(`/api/meetings/${meetingId}/signing-session`), context(meetingId));

    expect(response.status).toBe(403);
    expect(services.getMeetingSigningSession).not.toHaveBeenCalled();
  });

  it("returns only the public signing session fields with no-store caching", async () => {
    const services = servicesMock();
    const handler = createMeetingSigningSessionHandler({ services, actorResolver: treasurerResolver });
    const response = await handler(request(`/api/meetings/${meetingId}/signing-session`), context(meetingId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.signingUrl).toContain("firma.dev/signing");
    expect(body.requestId).toBeUndefined();
    expect(body.externalRequestId).toBeUndefined();
    expect(body.recipientId).toBeUndefined();
  });

  it("injects the Treasurer into retry, rejection, and outcome recovery actions", async () => {
    const services = servicesMock();
    const options = { services, actorResolver: treasurerResolver };
    const retry = createRetryMeetingSigningHandler(options);
    const reject = createRejectMeetingSigningHandler(options);
    const retryOutcome = createRetryMeetingSigningOutcomeHandler(options);

    const retryResponse = await retry(versionedRequest("signing/retry"), context(meetingId));
    const rejectResponse = await reject(jsonRequest(`/api/meetings/${meetingId}/signing/reject`, "POST", {
      expectedVersion: 4,
      comment: "Please correct the minutes.",
    }), context(meetingId));
    const outcomeResponse = await retryOutcome(versionedRequest("signing-outcome/retry"), context(meetingId));

    expect(retryResponse.status).toBe(200);
    expect(rejectResponse.status).toBe(200);
    expect(outcomeResponse.status).toBe(200);
    expect(services.retryMeetingSigning).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: treasurerId }));
    expect(services.rejectMeetingSigning).toHaveBeenCalledWith(expect.objectContaining({
      actorProfileId: treasurerId,
      comment: "Please correct the minutes.",
    }));
    expect(services.retryMeetingSigningOutcome).toHaveBeenCalledWith(expect.objectContaining({ actorProfileId: treasurerId }));
  });

  it("validates rejection comments and maps unavailable services", async () => {
    const services = servicesMock();
    const reject = createRejectMeetingSigningHandler({ services, actorResolver: treasurerResolver });
    const invalid = await reject(jsonRequest(`/api/meetings/${meetingId}/signing/reject`, "POST", {
      expectedVersion: 4,
      comment: " ",
    }), context(meetingId));
    expect(invalid.status).toBe(400);
    expect(services.rejectMeetingSigning).not.toHaveBeenCalled();

    services.retryMeetingSigning = vi.fn().mockRejectedValue(new Error("provider unavailable"));
    const retry = createRetryMeetingSigningHandler({ services, actorResolver: treasurerResolver });
    expect((await retry(versionedRequest("signing/retry"), context(meetingId))).status).toBe(503);
  });
});

function servicesMock() {
  return {
    listMeetingReviews: vi.fn().mockResolvedValue([summary()]),
    getMeetingReview: vi.fn().mockResolvedValue(detail()),
    saveMeetingDraft: vi.fn().mockResolvedValue({ status: "saved", meetingId, version: 5 }),
    deferMeetingReview: vi.fn().mockResolvedValue({ status: "deferred", meetingId, version: 5 }),
    resumeMeetingReview: vi.fn().mockResolvedValue({ status: "resumed", meetingId, version: 5 }),
    markMeetingReady: vi.fn().mockResolvedValue({ status: "ready", meetingId, version: 5 }),
    retryMeetingAnalysis: vi.fn().mockResolvedValue({
      status: "completed",
      meetingId,
      version: null,
      attempt: 1,
    }),
    approveMeeting: vi.fn().mockResolvedValue({
      status: "approved",
      meetingId,
      version: 5,
      unresolvedVoteCount: 0,
      documentVersion: 4,
    }),
    retryMeetingPdf: vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 5,
      documentVersion: 4,
    }),
    getMeetingSigningSession: vi.fn().mockResolvedValue({
      status: "available",
      meetingId,
      requestId: "55555555-5555-4555-8555-555555555555",
      externalRequestId: "firma-request-1",
      documentVersion: 4,
      providerStatus: "in_progress",
      recipientId: "firma-recipient-1",
      recipientEmail: "treasurer@example.test",
      signingUrl: "https://app.firma.dev/signing/firma-recipient-1",
    }),
    retryMeetingSigning: vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 5,
      pdfId: "66666666-6666-4666-8666-666666666666",
      documentVersion: 4,
    }),
    rejectMeetingSigning: vi.fn().mockResolvedValue({
      status: "rejected",
      meetingId,
      version: 5,
      documentVersion: 4,
    }),
    retryMeetingSigningOutcome: vi.fn().mockResolvedValue({
      status: "retry_started",
      meetingId,
      version: 5,
      documentVersion: 4,
      reconciliation: { status: "no_change" },
    }),
    searchArchive: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: meetingId,
    sourceMeetingId: "read-ai-meeting-1",
    title: "ANDA Board Meeting",
    category: "Board Meeting" as const,
    meetingDate: "2026-07-20",
    durationMinutes: 90,
    status: "PENDING_APPROVAL" as const,
    version: 4,
    deferredAt: null,
    deferredNote: null,
    humanOwned: true,
    failure: null,
    approval: null,
    pdfArtifact: {
      id: "66666666-6666-4666-8666-666666666666",
      path: "storage/unsigned.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 12_000,
      pageCount: 4,
      generatedAt: "2026-07-20T10:00:00.000Z",
      documentVersion: 4,
    },
    pdfAttempt: 1,
    updatedAt: "2026-07-20T10:00:00.000Z",
    ...overrides,
  };
}

function detail() {
  return {
    ...summary(),
    tags: ["governance"],
    minutes: {
      summary: "The board considered the agenda.",
      sections: [{ heading: "Opening", content: "The Chair opened the meeting." }],
    },
    transcript: {
      id: "77777777-7777-4777-8777-777777777777",
      sourceTranscriptId: "read-ai-transcript-1",
      content: "Meeting opened at 10:00.",
      metadata: {
        providerSecret: "must-not-leave-server",
        startTime: "2026-07-20T08:00:00.000Z",
        endTime: "2026-07-20T09:30:00.000Z",
        participants: [
          { name: "General Member", email: "MEMBER@example.test" },
          { name: "Unmatched Guest", email: "guest@example.test" },
        ],
      },
      importedAt: "2026-07-20T09:00:00.000Z",
    },
    attendees: [{
      attendeeId,
      profileId: attendeeId,
      displayName: "General Member",
      sourceEmailSnapshot: "member@example.test",
    }],
    motions: [],
    history: [],
  };
}

function validDraft() {
  return {
    minutes: {
      summary: "Updated summary.",
      sections: [{ heading: "Update", content: "Updated content." }],
    },
    attendeeProfileIds: [attendeeId],
    motions: [],
    tags: ["governance"],
  };
}

function request(path: string) {
  return new Request(`https://anda.test${path}`);
}

function jsonRequest(path: string, method: string, body: unknown) {
  return new Request(`https://anda.test${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function versionedRequest(path: string) {
  return jsonRequest(`/api/meetings/${meetingId}/${path}`, "POST", { expectedVersion: 4 });
}

function context(id: string) {
  return { params: Promise.resolve({ meetingId: id }) };
}
