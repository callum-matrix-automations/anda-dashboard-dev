import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";

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
    const record = {
      sourceMeetingId,
      title: "Transcript integration meeting",
      meetingDate: "2026-07-18",
      sourceTranscriptId,
      content,
    };

    const first = await repository.storeImport(record);
    const duplicate = await repository.storeImport(record);
    const meetings = await selectRows("meetings", "source_meeting_id", sourceMeetingId,
      "id,source_meeting_id,title,meeting_date,status");
    const transcripts = await selectRows("transcripts", "source_transcript_id", sourceTranscriptId,
      "id,meeting_id,source_transcript_id,content,metadata,imported_at");

    expect(first).toMatchObject({ status: "stored" });
    expect(duplicate).toEqual({ ...first, status: "duplicate" });
    expect(meetings).toEqual([{
      id: first.meetingId,
      source_meeting_id: sourceMeetingId,
      title: "Transcript integration meeting",
      meeting_date: "2026-07-18",
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

    const conflictingMeetingId = `meeting_conflict_${suffix}`;
    await expect(repository.storeImport({
      ...record,
      sourceMeetingId: conflictingMeetingId,
      content: `${content}\nTampered line.`,
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
