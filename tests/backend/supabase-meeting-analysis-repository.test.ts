import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import type { MeetingDraft } from "../../src/shared/contracts/meetingAnalysis";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";
const meetingId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const draft: MeetingDraft = {
  schemaVersion: "1.0",
  minutes: {
    summary: "A decision was made.",
    sections: [{ heading: "Decision", content: "The motion carried." }],
  },
  attendees: [{
    participantRef: "10000000-0000-4000-8000-000000000001",
    displayName: "Eleanor Hughes",
  }],
  motions: [],
};

describe("Supabase meeting analysis repository", () => {
  it("claims an analysis attempt and validates the returned input", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      claim_status: "claimed",
      run_id: runId,
      attempt_number: 1,
      analysis_input: {
        meeting: {
          sourceMeetingId: "meeting_source_001",
          title: "Board meeting",
          meetingDate: "2026-07-19",
          durationMinutes: 60,
        },
        transcript: { language: "und", content: "Chair: Meeting opened." },
        participants: [{
          participantRef: "10000000-0000-4000-8000-000000000001",
          displayName: "Eleanor Hughes",
        }],
      },
    }]));
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.claimAnalysis(meetingId)).resolves.toMatchObject({
      status: "claimed",
      meetingId,
      runId,
      attempt: 1,
    });

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/claim_meeting_analysis`);
    expect(request.headers).toMatchObject({
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_manual_retry: false,
    });
  });

  it("returns an idempotent non-claim without requiring analysis input", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      claim_status: "already_completed",
      run_id: null,
      attempt_number: 1,
      analysis_input: null,
    }]));
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.claimAnalysis(meetingId)).resolves.toEqual({
      status: "already_completed",
      meetingId,
      attempt: 1,
    });
  });

  it("persists the complete draft through the token-guarded RPC", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json("saved"));
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.persistDraft(meetingId, runId, draft)).resolves.toBe("saved");

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/persist_meeting_analysis_draft`);
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_draft: draft,
    });
  });

  it("records a sanitised failure through the active run token", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json("retry_scheduled"));
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.recordFailure(meetingId, runId, {
      code: "openai_timeout",
      message: "OpenAI request timed out.",
    })).resolves.toBe("retry_scheduled");

    const [, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_error_code: "openai_timeout",
      p_error_message: "OpenAI request timed out.",
    });
  });

  it("permanently marks content as human owned through a server-only RPC", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json("marked"));
    const repository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.markHumanOwned(meetingId)).resolves.toBe("marked");

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/mark_meeting_human_owned`);
    expect(JSON.parse(String(request.body))).toEqual({ p_meeting_id: meetingId });
  });
});
