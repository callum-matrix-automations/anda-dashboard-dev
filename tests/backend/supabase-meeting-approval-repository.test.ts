import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingApprovalRepository } from "../../src/backend/repositories/supabase/supabaseMeetingApprovalRepository";
import { approvedSnapshot, eleanorId, meetingId, runId } from "../helpers/meetingApproval";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";

describe("Supabase meeting approval repository", () => {
  it("maps approval and retry commands to versioned RPCs", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "approved",
        meetingId,
        version: 5,
        unresolvedVoteCount: 1,
        documentVersion: 4,
      }))
      .mockResolvedValueOnce(Response.json({
        status: "retry_started",
        meetingId,
        version: 9,
        documentVersion: 4,
      }));
    const repository = createSupabaseMeetingApprovalRepository({ apiUrl, secretKey, fetchImplementation });

    await repository.approve({
      meetingId,
      expectedVersion: 4,
      actorProfileId: eleanorId,
      acknowledgeUnresolvedVotes: true,
    });
    await repository.retryPdf({ meetingId, expectedVersion: 8, actorProfileId: eleanorId });

    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/approve_meeting_for_pdf`,
      body: {
        p_meeting_id: meetingId,
        p_expected_version: 4,
        p_actor_profile_id: eleanorId,
        p_acknowledge_unresolved_votes: true,
      },
    });
    expect(requestDetails(fetchImplementation, 1)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/retry_meeting_pdf_generation`,
      body: {
        p_meeting_id: meetingId,
        p_expected_version: 8,
        p_actor_profile_id: eleanorId,
      },
    });
  });

  it("claims the immutable snapshot and persists generated PDF metadata", async () => {
    const snapshot = approvedSnapshot();
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "claimed",
        meetingId,
        runId,
        attempt: 1,
        documentVersion: 4,
        snapshot,
      }))
      .mockResolvedValueOnce(Response.json("saved"));
    const repository = createSupabaseMeetingApprovalRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.claimPdfGeneration(meetingId)).resolves.toMatchObject({
      status: "claimed",
      snapshot,
    });
    await expect(repository.completePdfGeneration(meetingId, runId, {
      path: "unsigned/meeting/v4/minutes.pdf",
      sha256: "a".repeat(64),
      sizeBytes: 2_048,
      pageCount: 2,
    })).resolves.toBe("saved");

    expect(requestDetails(fetchImplementation, 1).body).toEqual({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_path: "unsigned/meeting/v4/minutes.pdf",
      p_sha256: "a".repeat(64),
      p_size_bytes: 2_048,
      p_page_count: 2,
    });
  });

  it("records sanitised generation failures through the active run", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json("failed"));
    const repository = createSupabaseMeetingApprovalRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.recordPdfFailure(meetingId, runId, {
      code: "pdf_storage_failed",
      message: "Storage rejected the upload.",
    })).resolves.toBe("failed");
    expect(requestDetails(fetchImplementation, 0).body).toEqual({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_error_code: "pdf_storage_failed",
      p_error_message: "Storage rejected the upload.",
    });
  });

  it("rejects malformed RPC responses", async () => {
    const repository = createSupabaseMeetingApprovalRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({ status: "unexpected" })),
    });
    await expect(repository.claimPdfGeneration(meetingId)).rejects.toMatchObject({
      code: "invalid_supabase_response",
    });
  });
});

function requestDetails(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [url, options] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return { url: url.href, body: JSON.parse(String(options.body)) as unknown };
}
