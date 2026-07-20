import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseOperationalAlertRepository } from "../../src/backend/repositories/supabase/supabaseOperationalAlertRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const localIntegrationConfigured = isLoopbackUrl(apiUrl) && Boolean(secretKey) && !secretKey.startsWith("replace-");
const reporterProfileId = "10000000-0000-4000-8000-000000000004";

describe.skipIf(!localIntegrationConfigured)("local operational recovery persistence", () => {
  it("deduplicates concurrent alerts, claims delivery once, resolves recovery, and records issue reports", async () => {
    const suffix = randomUUID();
    const storeTranscript = createTranscriptImportStore(createSupabaseTranscriptRepository({ apiUrl, secretKey }));
    const meeting = await storeTranscript(packet(suffix));
    const repository = createSupabaseOperationalAlertRepository({ apiUrl, secretKey });
    const input = {
      stage: "ARCHIVE" as const,
      meetingId: meeting.meetingId,
      failureCode: "archive_storage_failed",
      workflowStatus: "ARCHIVE_FAILED",
    };

    const writes = await Promise.all(Array.from({ length: 5 }, () => repository.record(input)));
    expect(writes.filter((result) => result.status === "created")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "deduplicated")).toHaveLength(4);
    const alertId = writes[0]?.alertId;
    if (!alertId) throw new Error("Operational alert was not created.");

    const alerts = await selectRows<{
      id: string;
      occurrence_count: number;
      delivery_status: string;
      failure_code: string;
      resolved_at: string | null;
    }>("operational_alerts", "id", alertId, "id,occurrence_count,delivery_status,failure_code,resolved_at");
    expect(alerts).toEqual([{
      id: alertId,
      occurrence_count: 5,
      delivery_status: "PENDING",
      failure_code: "archive_storage_failed",
      resolved_at: null,
    }]);

    const [firstClaims, secondClaims] = await Promise.all([
      repository.claimDeliveries(100, 3),
      repository.claimDeliveries(100, 3),
    ]);
    const targetClaims = [...firstClaims, ...secondClaims].filter((claim) => claim.alertId === alertId);
    expect(targetClaims).toHaveLength(1);
    const targetClaim = targetClaims[0];
    if (!targetClaim) throw new Error("Operational alert delivery was not claimed.");
    await expect(repository.completeDelivery(targetClaim.alertId, targetClaim.runId)).resolves.toBe("saved");

    await expect(repository.resolve({
      stage: "ARCHIVE",
      meetingId: meeting.meetingId,
      resolvedAt: "2026-07-20T18:00:00.000Z",
    })).resolves.toBe(1);
    const reopened = await repository.record(input);
    expect(reopened.status).toBe("created");
    expect(reopened.alertId).not.toBe(alertId);

    const report = await repository.createIssueReport({
      meetingId: meeting.meetingId,
      reporterProfileId,
      comment: "A private operator comment that must not be sent externally.",
    });
    expect(report).toMatchObject({ status: "created", meetingId: meeting.meetingId });
    if (report.status !== "created") throw new Error("Issue report was not created.");
    expect(await selectRows(
      "operational_issue_reports",
      "id",
      report.reportId,
      "meeting_id,reporter_profile_id,comment",
    )).toEqual([{
      meeting_id: meeting.meetingId,
      reporter_profile_id: reporterProfileId,
      comment: "A private operator comment that must not be sent externally.",
    }]);
  }, 30_000);
});

function packet(suffix: string) {
  return {
    eventId: `operations-event-${suffix}`,
    eventType: "transcript.ready" as const,
    occurredAt: "2026-07-20T16:00:00.000Z",
    sentAt: "2026-07-20T16:01:00.000Z",
    meeting: {
      sourceMeetingId: `operations-meeting-${suffix}`,
      title: "Operational recovery integration meeting",
      startedAt: "2026-07-20T15:00:00.000Z",
      endedAt: "2026-07-20T16:00:00.000Z",
      durationMinutes: 60,
    },
    attendees: [{ displayName: "Daniel Brooks", email: "daniel.brooks@example.test" }],
    transcript: {
      sourceTranscriptId: `operations-transcript-${suffix}`,
      contentType: "text/plain" as const,
      language: "en-GB",
      content: "Daniel Brooks: The operational recovery test meeting is open.",
      metadata: { provider: "read_ai", sessionId: suffix },
    },
  };
}

async function selectRows<T>(table: string, column: string, value: string, select: string): Promise<T[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set("select", select);
  url.searchParams.set(column, `eq.${value}`);
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    },
  });
  if (!response.ok) throw new Error(`Could not query ${table}: ${await response.text()}`);
  return response.json() as Promise<T[]>;
}

function isLoopbackUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}
