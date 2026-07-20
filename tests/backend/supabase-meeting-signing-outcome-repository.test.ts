import { describe, expect, it, vi } from "vitest";
import { createSupabaseMeetingSigningOutcomeRepository } from "../../src/backend/repositories/supabase/supabaseMeetingSigningOutcomeRepository";

const apiUrl = "https://supabase.example.test";
const secretKey = "test-service-role-key";
const meetingId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const eventRecordId = "33333333-3333-4333-8333-333333333333";
const runId = "44444444-4444-4444-8444-444444444444";

describe("Supabase signing outcome repository", () => {
  it("stores the complete webhook evidence and provider association", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      status: "accepted",
      eventRecordId,
      meetingId,
    }));
    const repository = createSupabaseMeetingSigningOutcomeRepository({ apiUrl, secretKey, fetchImplementation });
    const event = {
      id: "evt_1",
      type: "signing_request.completed",
      data: { signing_request: { id: "firma-request-1" } },
    };
    await expect(repository.receiveWebhook(event, "firma-request-1", "a".repeat(64)))
      .resolves.toMatchObject({ status: "accepted" });
    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/receive_firma_webhook_event`,
      body: {
        p_provider_event_id: "evt_1",
        p_event_type: "signing_request.completed",
        p_external_request_ref: "firma-request-1",
        p_payload_sha256: "a".repeat(64),
        p_payload: event,
      },
    });
  });

  it("maps a completion claim and verified signed-document metadata", async () => {
    const claim = {
      status: "claimed" as const,
      eventId: "evt_1",
      eventRecordId,
      meetingId,
      requestId,
      externalRequestId: "firma-request-1",
      documentVersion: 4,
      runId,
      attempt: 1,
    };
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json(claim))
      .mockResolvedValueOnce(Response.json("saved"));
    const repository = createSupabaseMeetingSigningOutcomeRepository({ apiUrl, secretKey, fetchImplementation });
    await expect(repository.claimWebhook("evt_1")).resolves.toEqual(claim);
    await expect(repository.completeOutcome(claim, {
      providerStatus: "finished",
      recipientRef: "recipient-1",
      recipientEmail: "treasurer@example.test",
      providerCompletedAt: "2026-07-20T12:00:00.000Z",
      signedDocumentSha256: "b".repeat(64),
      signedDocumentSizeBytes: 8_192,
    })).resolves.toBe("saved");
    expect(requestDetails(fetchImplementation, 1)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/complete_meeting_signing_outcome`,
      body: {
        p_request_id: requestId,
        p_run_id: runId,
        p_event_record_id: eventRecordId,
        p_provider_status: "finished",
        p_recipient_ref: "recipient-1",
        p_recipient_email: "treasurer@example.test",
        p_provider_completed_at: "2026-07-20T12:00:00.000Z",
        p_signed_document_sha256: "b".repeat(64),
        p_signed_document_size_bytes: 8_192,
      },
    });
  });

  it("maps mandatory-comment rejection and completion separately", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "claimed",
        meetingId,
        requestId,
        externalRequestId: "firma-request-1",
        runId,
        version: 8,
        documentVersion: 4,
      }))
      .mockResolvedValueOnce(Response.json({
        status: "rejected",
        meetingId,
        version: 9,
        documentVersion: 4,
      }));
    const repository = createSupabaseMeetingSigningOutcomeRepository({ apiUrl, secretKey, fetchImplementation });
    await repository.claimRejection({
      meetingId,
      expectedVersion: 8,
      actorProfileId: requestId,
      comment: "Correct the vote.",
    });
    await repository.completeRejection(requestId, runId);
    expect(requestDetails(fetchImplementation, 0)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/claim_meeting_signing_rejection`,
      body: {
        p_meeting_id: meetingId,
        p_expected_version: 8,
        p_actor_profile_id: requestId,
        p_comment: "Correct the vote.",
      },
    });
    expect(requestDetails(fetchImplementation, 1)).toEqual({
      url: `${apiUrl}/rest/v1/rpc/complete_meeting_signing_rejection`,
      body: { p_request_id: requestId, p_run_id: runId },
    });
  });
});

function requestDetails(fetchImplementation: ReturnType<typeof vi.fn>, index: number) {
  const [url, options] = fetchImplementation.mock.calls[index] as [URL, RequestInit];
  return { url: url.href, body: JSON.parse(String(options.body)) as unknown };
}
