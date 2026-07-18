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
      metadata: {},
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
