import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseTranscriptRepository,
  TranscriptRepositoryError,
} from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";

const record = {
  sourceMeetingId: "meeting_repository_test_001",
  title: "Repository test meeting",
  meetingDate: "2026-07-18",
  durationMinutes: 41,
  sourceTranscriptId: "transcript_repository_test_001",
  content: "Chair: Repository test transcript.",
  attendees: [{
    profileId: "10000000-0000-4000-8000-000000000001",
    displayNameSnapshot: "Eleanor Hughes",
  }],
};

const rpcRow = {
  ingestion_status: "received",
  meeting_id: "11111111-1111-4111-8111-111111111111",
  transcript_id: "22222222-2222-4222-8222-222222222222",
  imported_at: "2026-07-18T18:01:00.000Z",
};

describe("Supabase transcript repository", () => {
  it("lists active member profiles for deterministic display-name matching", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      id: "10000000-0000-4000-8000-000000000001",
      display_name: "Eleanor Hughes",
    }]));
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "test-secret-key",
      fetchImplementation,
    });

    await expect(repository.listActiveMemberProfiles()).resolves.toEqual([{
      profileId: "10000000-0000-4000-8000-000000000001",
      displayName: "Eleanor Hughes",
    }]);
    const [url, init] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/rest/v1/profiles");
    expect(url.searchParams.get("account_type")).toBe("eq.MEMBER");
    expect(url.searchParams.get("account_status")).toBe("eq.ACTIVE");
    expect(init.headers).toMatchObject({ authorization: "Bearer test-secret-key" });
  });

  it("calls the restricted ingestion RPC and maps a stored result", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([rpcRow]));
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "test-secret-key",
      fetchImplementation,
    });

    await expect(repository.storeImport(record)).resolves.toEqual({
      status: "stored",
      meetingId: rpcRow.meeting_id,
      transcriptId: rpcRow.transcript_id,
      importedAt: rpcRow.imported_at,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe("https://supabase.example.test/rest/v1/rpc/ingest_transcript_webhook");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      apikey: "test-secret-key",
      authorization: "Bearer test-secret-key",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      p_source_meeting_id: record.sourceMeetingId,
      p_title: record.title,
      p_meeting_date: record.meetingDate,
      p_duration_minutes: record.durationMinutes,
      p_source_transcript_id: record.sourceTranscriptId,
      p_content: record.content,
      p_attendees: [{
        profile_id: "10000000-0000-4000-8000-000000000001",
        display_name_snapshot: "Eleanor Hughes",
      }],
    });
  });

  it("maps a durable duplicate returned by the database", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      ...rpcRow,
      ingestion_status: "duplicate",
    }]));
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "test-secret-key",
      fetchImplementation,
    });

    await expect(repository.storeImport(record)).resolves.toMatchObject({ status: "duplicate" });
  });

  it("surfaces a structured Supabase failure without exposing credentials", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      code: "23505",
      message: "Source transcript identifier conflicts with immutable evidence.",
    }, { status: 409 }));
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "never-expose-this-secret",
      fetchImplementation,
    });

    const error = await repository.storeImport(record).catch((caught) => caught);

    expect(error).toBeInstanceOf(TranscriptRepositoryError);
    expect(error).toMatchObject({ status: 409, code: "23505" });
    expect(String(error)).not.toContain("never-expose-this-secret");
  });

  it("rejects malformed success responses", async () => {
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "test-secret-key",
      fetchImplementation: vi.fn().mockResolvedValue(Response.json([])),
    });

    await expect(repository.storeImport(record)).rejects.toMatchObject({
      code: "invalid_supabase_response",
    });
  });

  it("fails before making a request when server credentials are missing", async () => {
    const fetchImplementation = vi.fn();
    const repository = createSupabaseTranscriptRepository({
      apiUrl: "",
      secretKey: "",
      fetchImplementation,
    });

    await expect(repository.storeImport(record)).rejects.toMatchObject({
      code: "supabase_not_configured",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
