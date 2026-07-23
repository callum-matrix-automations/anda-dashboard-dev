import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { ServerActor } from "../../src/backend/auth/serverActor";
import { processManualTranscriptUpload } from "../../src/backend/services/transcripts/processManualTranscriptUpload";

const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
const liveConfigured = isLoopbackUrl(apiUrl)
  && Boolean(secretKey)
  && !secretKey.startsWith("replace-")
  && Boolean(process.env.OPENAI_API_KEY?.trim());

const actor: ServerActor = {
  profileId: "10000000-0000-4000-8000-000000000001",
  displayName: "Eleanor Hughes",
  role: "OFFICER",
  isAdmin: true,
};

describe.skipIf(!liveConfigured)("live manual transcript upload workflow", () => {
  it("extracts attendees and motions from a pasted plain-text transcript", async () => {
    const transcript = await readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8");
    const result = await processManualTranscriptUpload({
      title: `Live manual transcript test ${randomUUID()}`,
      meetingDate: "2026-07-25",
      durationMinutes: 90,
      transcript,
    }, actor);

    expect(result.status).toBe("pending_approval");
    const [attendees, motions] = await Promise.all([
      selectRows("meeting_attendees", result.meetingId, "display_name_snapshot"),
      selectRows("motions", result.meetingId, "motion_text,outcome"),
    ]);

    expect(attendees.map((attendee) => attendee.display_name_snapshot)).toEqual(expect.arrayContaining([
      "Eleanor Hughes",
      "Marcus Patel",
      "Priya Shah",
      "Daniel Brooks",
      "Amelia Clarke",
    ]));
    expect(attendees).toHaveLength(5);
    expect(motions.length).toBeGreaterThanOrEqual(4);
    expect(motions.map((motion) => motion.outcome)).toEqual(expect.arrayContaining([
      "CARRIED",
      "FAILED",
      "TABLED",
    ]));
  }, 180_000);
});

async function selectRows(
  table: string,
  meetingId: string,
  select: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set("meeting_id", `eq.${meetingId}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    throw new Error(`Local Supabase query for ${table} failed with HTTP ${response.status}.`);
  }
  return response.json() as Promise<Record<string, unknown>[]>;
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}
