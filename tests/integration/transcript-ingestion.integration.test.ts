import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const localIntegrationConfigured = isLoopbackUrl(apiUrl) && Boolean(secretKey) && !secretKey.startsWith("replace-");

describe.skipIf(!localIntegrationConfigured)("local Supabase transcript ingestion", () => {
  it("atomically stores, links, and deduplicates immutable transcript evidence", async () => {
    const suffix = randomUUID();
    const sourceMeetingId = `meeting_integration_${suffix}`;
    const sourceTranscriptId = `transcript_integration_${suffix}`;
    const content = "Chair: Exact source line one.\nSecretary: Exact source line two.";
    const repository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
    const storeTranscript = createTranscriptImportStore(repository);
    const packet = {
      eventId: `event_integration_${suffix}`,
      eventType: "transcript.ready" as const,
      occurredAt: "2026-07-18T18:00:00.000Z",
      sentAt: "2026-07-18T18:01:00.000Z",
      meeting: {
        sourceMeetingId,
        title: "Transcript integration meeting",
        startedAt: "2026-07-18T17:00:00.000Z",
        endedAt: "2026-07-18T18:00:00.000Z",
        durationMinutes: 60,
      },
      attendees: [
        { displayName: "  ELEANOR   HUGHES " },
        { displayName: "Marcus Patel" },
        { displayName: "Unmatched Visitor" },
      ],
      transcript: {
        sourceTranscriptId,
        contentType: "text/plain" as const,
        language: "en-GB",
        content,
        metadata: {
          provider: "read_ai",
          sessionId: suffix,
          requestId: `request_${suffix}`,
          platformMeetingId: `platform_${suffix}`,
        },
      },
    };

    const first = await storeTranscript(packet);
    const duplicate = await storeTranscript(packet);
    const meetings = await selectRows("meetings", "source_meeting_id", sourceMeetingId,
      "id,source_meeting_id,title,meeting_date,duration_minutes,status");
    const transcripts = await selectRows("transcripts", "source_transcript_id", sourceTranscriptId,
      "id,meeting_id,source_transcript_id,content,metadata,imported_at");
    const attendees = await selectRows("meeting_attendees", "meeting_id", first.meetingId,
      "profile_id,display_name_snapshot");

    expect(first).toMatchObject({ status: "stored" });
    expect(duplicate).toEqual({ ...first, status: "duplicate" });
    expect(meetings).toEqual([{
      id: first.meetingId,
      source_meeting_id: sourceMeetingId,
      title: "Transcript integration meeting",
      meeting_date: "2026-07-18",
      duration_minutes: 60,
      status: "AI_PROCESSING",
    }]);
    expect(transcripts).toEqual([{
      id: first.transcriptId,
      meeting_id: first.meetingId,
      source_transcript_id: sourceTranscriptId,
      content,
      metadata: {
        provider: "read_ai",
        sessionId: suffix,
        requestId: `request_${suffix}`,
        platformMeetingId: `platform_${suffix}`,
      },
      imported_at: first.importedAt,
    }]);
    expect(attendees).toEqual(expect.arrayContaining([
      {
        profile_id: "10000000-0000-4000-8000-000000000001",
        display_name_snapshot: "Eleanor Hughes",
      },
      {
        profile_id: "10000000-0000-4000-8000-000000000002",
        display_name_snapshot: "Marcus Patel",
      },
    ]));
    expect(attendees).toHaveLength(2);

    const conflictingMeetingId = `meeting_conflict_${suffix}`;
    await expect(storeTranscript({
      ...packet,
      eventId: `event_conflict_${suffix}`,
      meeting: { ...packet.meeting, sourceMeetingId: conflictingMeetingId },
      transcript: { ...packet.transcript, content: `${content}\nTampered line.` },
    })).rejects.toMatchObject({ code: "23505" });

    expect(await selectRows("meetings", "source_meeting_id", conflictingMeetingId, "id")).toEqual([]);
    expect(await selectRows("transcripts", "source_transcript_id", sourceTranscriptId, "content"))
      .toEqual([{ content }]);
  });

  it("deduplicates failure alerts and resolves them after recovery", async () => {
    const suffix = randomUUID();
    const sourceMeetingId = `read_ai:failure_${suffix}`;
    const repository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
    const firstFailedAt = "2026-07-20T10:00:00.000Z";
    const secondFailedAt = "2026-07-20T10:01:00.000Z";
    const resolvedAt = "2026-07-20T10:02:00.000Z";
    const failure = {
      sourceProvider: "read_ai" as const,
      sourceMeetingId,
      requestId: `request_${suffix}`,
      title: "Read AI failed import",
      platformMeetingId: `platform_${suffix}`,
      errorCode: "receive_failed",
      errorMessage: "Temporary persistence failure",
      attempts: 4,
      failedAt: firstFailedAt,
    };

    await repository.recordFailure(failure);
    await repository.recordFailure({
      ...failure,
      requestId: `request_retry_${suffix}`,
      errorMessage: "Second temporary persistence failure",
      failedAt: secondFailedAt,
    });

    const failureRows = await selectRows(
      "transcript_import_failures",
      "source_meeting_id",
      sourceMeetingId,
      "source_provider,source_meeting_id,latest_request_id,error_message,attempts,occurrence_count,first_failed_at,last_failed_at,resolved_at",
    );
    expect(failureRows).toEqual([expect.objectContaining({
      source_provider: "read_ai",
      source_meeting_id: sourceMeetingId,
      latest_request_id: `request_retry_${suffix}`,
      error_message: "Second temporary persistence failure",
      attempts: 4,
      occurrence_count: 2,
      resolved_at: null,
    })]);
    const failureRow = failureRows[0] as Record<string, unknown>;
    expect(new Date(String(failureRow.first_failed_at)).toISOString()).toBe(firstFailedAt);
    expect(new Date(String(failureRow.last_failed_at)).toISOString()).toBe(secondFailedAt);

    await repository.resolveFailure("read_ai", sourceMeetingId, resolvedAt);
    const resolvedRows = await selectRows(
      "transcript_import_failures",
      "source_meeting_id",
      sourceMeetingId,
      "resolved_at",
    );
    const resolvedRow = resolvedRows[0] as Record<string, unknown>;
    expect(new Date(String(resolvedRow.resolved_at)).toISOString()).toBe(resolvedAt);
  });
});

async function selectRows(table: string, column: string, value: string, select: string): Promise<unknown[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    },
  });
  if (!response.ok) throw new Error(`Local Supabase query failed with HTTP ${response.status}.`);
  return response.json() as Promise<unknown[]>;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
