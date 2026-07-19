import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingReviewRepository } from "../../src/backend/repositories/supabase/supabaseMeetingReviewRepository";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";
const meetingId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "10000000-0000-4000-8000-000000000001";

describe("Supabase meeting review repository", () => {
  it("loads and validates meeting list and detail RPC responses", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json([summary()]))
      .mockResolvedValueOnce(Response.json(detail()));
    const repository = createSupabaseMeetingReviewRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.listReviews()).resolves.toHaveLength(1);
    await expect(repository.getReview(meetingId)).resolves.toMatchObject({
      id: meetingId,
      status: "PENDING_APPROVAL",
      transcript: { content: "Full transcript." },
    });

    expect((fetchImplementation.mock.calls[0]?.[0] as URL).href)
      .toBe(`${apiUrl}/rest/v1/rpc/list_meeting_reviews`);
    expect((fetchImplementation.mock.calls[1]?.[0] as URL).href)
      .toBe(`${apiUrl}/rest/v1/rpc/get_meeting_review`);
    expect(JSON.parse(String((fetchImplementation.mock.calls[1]?.[1] as RequestInit).body)))
      .toEqual({ p_meeting_id: meetingId });
  });

  it("sends the complete versioned draft to the atomic save RPC", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: "saved",
      meetingId,
      version: 4,
    }));
    const repository = createSupabaseMeetingReviewRepository({ apiUrl, secretKey, fetchImplementation });
    const command = {
      meetingId,
      expectedVersion: 3,
      actorProfileId,
      draft: {
        minutes: { summary: "Updated.", sections: [{ heading: "Item", content: "Decision." }] },
        attendeeProfileIds: [actorProfileId],
        motions: [],
        tags: ["updated"],
      },
    };

    await expect(repository.saveDraft(command)).resolves.toEqual({ status: "saved", meetingId, version: 4 });

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/save_meeting_review_draft`);
    expect(request.headers).toMatchObject({
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_expected_version: 3,
      p_actor_profile_id: actorProfileId,
      p_draft: command.draft,
    });
  });

  it.each([
    ["deferReview", "defer_meeting_review", { note: "Awaiting evidence." }, { p_note: "Awaiting evidence." }],
    ["resumeReview", "resume_meeting_review", {}, {}],
    ["markReady", "mark_meeting_ready", {}, {}],
  ] as const)("maps %s to its review RPC", async (method, rpcName, additions, rpcAdditions) => {
    const successStatus = method === "deferReview" ? "deferred" : method === "resumeReview" ? "resumed" : "ready";
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: successStatus,
      meetingId,
      version: 5,
    }));
    const repository = createSupabaseMeetingReviewRepository({ apiUrl, secretKey, fetchImplementation });
    const command = { meetingId, expectedVersion: 4, actorProfileId };

    if (method === "deferReview") {
      await repository.deferReview({ ...command, note: additions.note ?? "" });
    } else if (method === "resumeReview") {
      await repository.resumeReview(command);
    } else {
      await repository.markReady(command);
    }

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/${rpcName}`);
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_expected_version: 4,
      p_actor_profile_id: actorProfileId,
      ...rpcAdditions,
    });
  });

  it("rejects malformed Supabase review responses", async () => {
    const repository = createSupabaseMeetingReviewRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({ status: "surprise" })),
    });

    await expect(repository.markReady({ meetingId, expectedVersion: 1, actorProfileId }))
      .rejects.toMatchObject({ code: "invalid_supabase_response" });
  });
});

function summary() {
  return {
    id: meetingId,
    sourceMeetingId: "source-meeting-1",
    title: "Board meeting",
    meetingDate: "2026-07-19",
    durationMinutes: 60,
    status: "PENDING_APPROVAL",
    version: 3,
    deferredAt: null,
    deferredNote: null,
    humanOwned: false,
    failure: null,
    approval: null,
    pdfArtifact: null,
    pdfAttempt: 0,
    updatedAt: "2026-07-19T12:00:00.000Z",
  };
}

function detail() {
  return {
    ...summary(),
    tags: [],
    minutes: {
      summary: "The board met.",
      sections: [{ heading: "Opening", content: "The meeting opened." }],
    },
    transcript: {
      id: "22222222-2222-4222-8222-222222222222",
      sourceTranscriptId: "source-transcript-1",
      content: "Full transcript.",
      metadata: {},
      importedAt: "2026-07-19T11:00:00.000Z",
    },
    attendees: [{
      attendeeId: "33333333-3333-4333-8333-333333333333",
      profileId: actorProfileId,
      displayName: "Eleanor Hughes",
    }],
    motions: [],
    history: [],
  };
}
