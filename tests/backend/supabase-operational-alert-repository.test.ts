import { describe, expect, it, vi } from "vitest";
import { createSupabaseOperationalAlertRepository } from "../../src/backend/repositories/supabase/supabaseOperationalAlertRepository";

const meetingId = "11111111-1111-4111-8111-111111111111";
const alertId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";

describe("Supabase operational alert repository", () => {
  it("uses service-role RPCs for durable alert lifecycle operations", async () => {
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: "created",
        alertId,
        occurrenceCount: 1,
        deliveryStatus: "PENDING",
      }))
      .mockResolvedValueOnce(Response.json([{
        alertId,
        runId,
        stage: "ARCHIVE",
        meetingId,
        entityRef: null,
        failureCode: "archive_failed",
        workflowStatus: "ARCHIVE_FAILED",
        occurredAt: "2026-07-20T12:00:00.000Z",
        attempt: 1,
      }]))
      .mockResolvedValueOnce(Response.json("saved"))
      .mockResolvedValueOnce(Response.json("retry_scheduled"));
    const repository = createSupabaseOperationalAlertRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "service-role-key",
      fetchImplementation,
    });

    await repository.record({
      stage: "ARCHIVE",
      meetingId,
      failureCode: "archive_failed",
      workflowStatus: "ARCHIVE_FAILED",
    });
    await repository.claimDeliveries(10, 3);
    await repository.completeDelivery(alertId, runId);
    await repository.recordDeliveryFailure(alertId, runId, "telegram_http_503", 30, 3);

    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    const first = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(first[0].pathname).toBe("/rest/v1/rpc/record_operational_alert");
    expect(first[1].headers).toEqual(expect.objectContaining({
      apikey: "service-role-key",
      authorization: "Bearer service-role-key",
    }));
    expect(JSON.parse(String(first[1].body))).toMatchObject({
      p_stage: "ARCHIVE",
      p_meeting_id: meetingId,
      p_failure_code: "archive_failed",
    });
  });

  it("loads bounded signing candidates and creates user issue reports", async () => {
    const reportId = "44444444-4444-4444-8444-444444444444";
    const fetchImplementation = vi.fn()
      .mockResolvedValueOnce(Response.json([meetingId]))
      .mockResolvedValueOnce(Response.json({
        status: "created",
        meetingId,
        reportId,
        alertId,
        alertStatus: "deduplicated",
      }));
    const repository = createSupabaseOperationalAlertRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "service-role-key",
      fetchImplementation,
    });

    await expect(repository.listStaleSigningCandidates(15, 20, 5)).resolves.toEqual([meetingId]);
    await expect(repository.createIssueReport({
      meetingId,
      reporterProfileId: runId,
      comment: "Please investigate.",
    })).resolves.toMatchObject({ status: "created", reportId });

    const firstRequest = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(firstRequest[1].body))).toEqual({
      p_age_minutes: 15,
      p_limit: 20,
      p_max_attempts: 5,
    });
  });

  it("atomically claims stale signing work for overlapping schedulers", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json([{
      status: "claimed",
      eventId: null,
      eventRecordId: null,
      meetingId,
      requestId: alertId,
      externalRequestId: "firma-request-1",
      documentVersion: 4,
      runId,
      attempt: 2,
    }]));
    const repository = createSupabaseOperationalAlertRepository({
      apiUrl: "https://supabase.example.test",
      secretKey: "service-role-key",
      fetchImplementation,
    });

    await expect(repository.claimStaleSigningCandidates(10, 25, 5)).resolves.toHaveLength(1);
    const request = fetchImplementation.mock.calls[0] as [URL, RequestInit];
    expect(request[0].pathname).toBe("/rest/v1/rpc/claim_stale_signing_reconciliations");
    expect(JSON.parse(String(request[1].body))).toEqual({
      p_age_minutes: 10,
      p_limit: 25,
      p_max_attempts: 5,
    });
  });
});
