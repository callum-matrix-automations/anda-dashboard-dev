import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingArchiveRepository } from "../../src/backend/repositories/supabase/supabaseMeetingArchiveRepository";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-key";
const meetingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

describe("Supabase meeting archive repository", () => {
  it("maps archive claim, completion, and failure RPC contracts", async () => {
    const claim = {
      status: "claimed",
      meetingId,
      requestId,
      externalRequestId: "firma-request-1",
      documentVersion: 5,
      runId,
      attempt: 1,
      unsignedPdfPath: `unsigned/${meetingId}/v5/minutes.pdf`,
      expectedSha256: "a".repeat(64),
      expectedSizeBytes: 10_000,
    };
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json(claim))
      .mockResolvedValueOnce(Response.json({
        status: "completed",
        meetingId,
        signedPdfId: requestId,
        completedAt: "2026-07-20T14:00:00.000Z",
        version: 9,
      }))
      .mockResolvedValueOnce(Response.json({
        status: "failed",
        meetingId,
        attempt: 2,
        version: 10,
      }));
    const repository = createSupabaseMeetingArchiveRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.claim(meetingId)).resolves.toEqual(claim);
    await repository.complete({
      meetingId,
      runId,
      storagePath: `signed/${meetingId}/v5/minutes-signed.pdf`,
      sha256: "a".repeat(64),
      sizeBytes: 10_000,
      pageCount: 4,
    });
    await repository.recordFailure(meetingId, runId, { code: "storage_down", message: "Offline" });

    expect(requestBody(fetchImplementation, 0)).toEqual({ p_meeting_id: meetingId });
    expect(requestBody(fetchImplementation, 1)).toMatchObject({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_page_count: 4,
    });
    expect(requestBody(fetchImplementation, 2)).toEqual({
      p_meeting_id: meetingId,
      p_run_id: runId,
      p_error_code: "storage_down",
      p_error_message: "Offline",
    });
  });

  it("maps archive filters and strips the internal storage path from repository metadata", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({ items: [], total: 0, limit: 10, offset: 20 }))
      .mockResolvedValueOnce(Response.json({
        status: "available",
        meetingId,
        title: "ANDA Board Meeting",
        meetingDate: "2026-07-20",
        category: "Board Meeting",
        tags: ["budget"],
        minutes: { summary: "Approved" },
        motions: [{
          id: runId,
          text: "Table the procurement policy decision.",
          outcome: "TABLED",
        }],
        signedBy: requestId,
        signedAt: "2026-07-20T13:00:00.000Z",
        signedPdfId: requestId,
        completedAt: "2026-07-20T14:00:00.000Z",
        version: 9,
        document: {
          pdfId: requestId,
          path: "signed/private.pdf",
          sha256: "b".repeat(64),
          sizeBytes: 12_000,
          pageCount: 3,
          documentVersion: 8,
        },
      }));
    const repository = createSupabaseMeetingArchiveRepository({ apiUrl, secretKey, fetchImplementation });

    await repository.search({
      query: "budget",
      year: 2026,
      category: "Board Meeting",
      limit: 10,
      offset: 20,
    });
    await expect(repository.get(meetingId)).resolves.toMatchObject({
      status: "available",
      archive: {
        storagePath: "signed/private.pdf",
        motions: [expect.objectContaining({ outcome: "TABLED" })],
      },
    });
    expect(requestBody(fetchImplementation, 0)).toEqual({
      p_query: "budget",
      p_year: 2026,
      p_category: "Board Meeting",
      p_limit: 10,
      p_offset: 20,
    });
  });
});

function requestBody(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [, options] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return JSON.parse(String(options.body)) as unknown;
}
