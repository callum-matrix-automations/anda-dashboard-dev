import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingSigningRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningRepository";
import { eleanorId, meetingId, runId } from "../helpers/meetingApproval";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";
const pdfId = "33333333-3333-4333-8333-333333333333";

describe("Supabase meeting signing repository", () => {
  it("claims the exact approved PDF and maps its immutable metadata", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: "claimed",
      meetingId,
      runId,
      attempt: 1,
      pdfId,
      pdfPath: `unsigned/${meetingId}/v4/minutes.pdf`,
      pdfSha256: "a".repeat(64),
      pdfSizeBytes: 2_048,
      documentVersion: 4,
      requestName: `ANDA meeting ${meetingId} v4`,
      externalRequestId: null,
    }));
    const repository = createSupabaseMeetingSigningRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.claimDelivery(meetingId)).resolves.toMatchObject({
      status: "claimed",
      pdfId,
      documentVersion: 4,
    });
    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/claim_meeting_signing_delivery`,
      body: { p_meeting_id: meetingId },
    });
  });

  it("persists the provider reference before completing delivery", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json("saved"))
      .mockResolvedValueOnce(Response.json("saved"));
    const repository = createSupabaseMeetingSigningRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.recordRequestCreated(meetingId, runId, "firma-request-1"))
      .resolves.toBe("saved");
    await expect(repository.completeDelivery(meetingId, runId)).resolves.toBe("saved");

    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/record_meeting_signing_request_created`,
      body: {
        p_meeting_id: meetingId,
        p_run_id: runId,
        p_external_request_ref: "firma-request-1",
      },
    });
    expect(requestDetails(fetchImplementation, 1)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/complete_meeting_signing_delivery`,
      body: { p_meeting_id: meetingId, p_run_id: runId },
    });
  });

  it("records sanitised failures through the active delivery run", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json("failed"));
    const repository = createSupabaseMeetingSigningRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.recordFailure(meetingId, runId, {
      code: "firma_send_failed",
      message: "Firma rejected delivery.",
    })).resolves.toBe("failed");
    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/record_meeting_signing_failure`,
      body: {
        p_meeting_id: meetingId,
        p_run_id: runId,
        p_error_code: "firma_send_failed",
        p_error_message: "Firma rejected delivery.",
      },
    });
  });

  it("maps the authorised, versioned retry to the signing RPC", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: "retry_started",
      meetingId,
      version: 9,
      pdfId,
      documentVersion: 4,
    }));
    const repository = createSupabaseMeetingSigningRepository({ apiUrl, secretKey, fetchImplementation });

    await expect(repository.retryDelivery({
      meetingId,
      expectedVersion: 8,
      actorProfileId: eleanorId,
    })).resolves.toMatchObject({ status: "retry_started", pdfId });
    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/retry_meeting_signing_delivery`,
      body: {
        p_meeting_id: meetingId,
        p_expected_version: 8,
        p_actor_profile_id: eleanorId,
      },
    });
  });

  it("rejects malformed signing RPC responses", async () => {
    const repository = createSupabaseMeetingSigningRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json({ status: "claimed" })),
    });
    await expect(repository.claimDelivery(meetingId)).rejects.toMatchObject({
      code: "invalid_supabase_response",
    });
  });

  it("surfaces Supabase errors without exposing credentials", async () => {
    const repository = createSupabaseMeetingSigningRepository({
      apiUrl,
      secretKey,
      fetchImplementation: vi.fn().mockResolvedValue(Response.json(
        { code: "P0001", message: "Signing claim rejected." },
        { status: 409 },
      )),
    });
    const failure = await repository.claimDelivery(meetingId).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "P0001", status: 409, message: "Signing claim rejected." });
    expect(String(failure)).not.toContain(secretKey);
  });
});

function requestDetails(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [url, options] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return { url: url.href, body: JSON.parse(String(options.body)) as unknown };
}
