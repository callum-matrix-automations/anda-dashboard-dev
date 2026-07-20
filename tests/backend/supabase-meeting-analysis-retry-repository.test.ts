import { describe, expect, it, vi } from "vitest";
import {
  createSupabaseMeetingAnalysisRetryRepository,
} from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRetryRepository";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";
const meetingId = "11111111-1111-4111-8111-111111111111";
const actorProfileId = "22222222-2222-4222-8222-222222222222";

describe("Supabase meeting analysis retry repository", () => {
  it("sends the versioned actor command to the atomic preparation RPC", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: "retry_started",
      meetingId,
      version: 8,
    }));
    const repository = createSupabaseMeetingAnalysisRetryRepository({
      apiUrl,
      secretKey,
      fetchImplementation,
    });

    await expect(repository.prepareRetry({ meetingId, expectedVersion: 7, actorProfileId }))
      .resolves.toEqual({ status: "retry_started", meetingId, version: 8 });

    const [url, request] = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${apiUrl}/rest/v1/rpc/prepare_meeting_analysis_retry`);
    expect(request.headers).toMatchObject({
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      p_meeting_id: meetingId,
      p_expected_version: 7,
      p_actor_profile_id: actorProfileId,
    });
  });

  it("accepts safe conflict results and rejects malformed responses", async () => {
    const conflictRepository = createSupabaseMeetingAnalysisRetryRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({
        status: "conflict",
        meetingId,
        version: 9,
      })),
    });
    await expect(conflictRepository.prepareRetry({ meetingId, expectedVersion: 7, actorProfileId }))
      .resolves.toMatchObject({ status: "conflict", version: 9 });

    const malformedRepository = createSupabaseMeetingAnalysisRetryRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({
        status: "provider_secret_status",
        meetingId,
        version: 9,
      })),
    });
    await expect(malformedRepository.prepareRetry({ meetingId, expectedVersion: 7, actorProfileId }))
      .rejects.toMatchObject({ code: "invalid_supabase_response" });
  });

  it("normalizes transport failures without exposing response bodies", async () => {
    const repository = createSupabaseMeetingAnalysisRetryRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        code: "PGRST500",
        message: "Private database detail",
      }), { status: 500 })),
    });

    await expect(repository.prepareRetry({ meetingId, expectedVersion: 7, actorProfileId }))
      .rejects.toMatchObject({ code: "PGRST500", status: 500 });
  });
});
