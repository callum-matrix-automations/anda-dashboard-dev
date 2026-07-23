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
        { displayName: "  Source   Eleanor ", email: " ELEANOR.HUGHES@EXAMPLE.TEST " },
        { displayName: "Marcus from Read", email: "marcus.patel@example.test" },
        { displayName: "Eleanor Hughes" },
        { displayName: "Unmatched Visitor", email: "unknown@example.test" },
        { displayName: "Malformed Visitor", email: "not-an-email" },
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
          participants: [
            { name: "  Source   Eleanor ", email: " ELEANOR.HUGHES@EXAMPLE.TEST " },
            { name: "Marcus from Read", email: "marcus.patel@example.test" },
            { name: "Eleanor Hughes", email: null },
            { name: "Unmatched Visitor", email: "unknown@example.test" },
            { name: "Malformed Visitor", email: "not-an-email" },
          ],
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
      "profile_id,display_name_snapshot,source_email_snapshot");

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
        participants: [
          { name: "  Source   Eleanor ", email: " ELEANOR.HUGHES@EXAMPLE.TEST " },
          { name: "Marcus from Read", email: "marcus.patel@example.test" },
          { name: "Eleanor Hughes", email: null },
          { name: "Unmatched Visitor", email: "unknown@example.test" },
          { name: "Malformed Visitor", email: "not-an-email" },
        ],
      },
      imported_at: first.importedAt,
    }]);
    expect(attendees).toEqual(expect.arrayContaining([
      {
        profile_id: "10000000-0000-4000-8000-000000000001",
        display_name_snapshot: "Source Eleanor",
        source_email_snapshot: "eleanor.hughes@example.test",
      },
      {
        profile_id: "10000000-0000-4000-8000-000000000002",
        display_name_snapshot: "Marcus from Read",
        source_email_snapshot: "marcus.patel@example.test",
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

  it("uses only a profile's current email while preserving existing UUID associations", async () => {
    const suffix = randomUUID();
    const previousEmail = `previous-${suffix}@example.test`;
    const currentEmail = `current-${suffix}@example.test`;
    const profile = await createLocalProfile(previousEmail, `Changed Email ${suffix}`);
    const repository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
    const storeTranscript = createTranscriptImportStore(repository);

    const first = await storeTranscript(createPacket(`before-change-${suffix}`, previousEmail));
    expect(await attendeeProfileIds(first.meetingId)).toEqual([profile.id]);

    await updateProfileEmail(profile.id, currentEmail);
    expect(await attendeeProfileIds(first.meetingId)).toEqual([profile.id]);

    const previousEmailMeeting = await storeTranscript(createPacket(`old-email-${suffix}`, previousEmail));
    expect(await attendeeProfileIds(previousEmailMeeting.meetingId)).toEqual([]);

    const currentEmailMeeting = await storeTranscript(createPacket(`new-email-${suffix}`, currentEmail));
    expect(await attendeeProfileIds(currentEmailMeeting.meetingId)).toEqual([profile.id]);
  });

  it("idempotently resolves preserved metadata after the matching profile exists", async () => {
    const suffix = randomUUID();
    const email = `later-profile-${suffix}@example.test`;
    const repository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
    const storeTranscript = createTranscriptImportStore(repository);
    const stored = await storeTranscript(createPacket(`later-resolution-${suffix}`, email));

    expect(await attendeeProfileIds(stored.meetingId)).toEqual([]);
    const profile = await createLocalProfile(email, `Later Profile ${suffix}`);

    await expect(repository.resolveUnmatchedParticipants(stored.meetingId)).resolves.toBe(1);
    await expect(repository.resolveUnmatchedParticipants(stored.meetingId)).resolves.toBe(0);
    expect(await selectRows(
      "meeting_attendees",
      "meeting_id",
      stored.meetingId,
      "profile_id,display_name_snapshot,source_email_snapshot",
    )).toEqual([{
      profile_id: profile.id,
      display_name_snapshot: "Read AI Guest",
      source_email_snapshot: email,
    }]);
    expect(await selectRows(
      "transcripts",
      "meeting_id",
      stored.meetingId,
      "metadata",
    )).toEqual([{
      metadata: expect.objectContaining({
        participants: [{ name: "Read AI Guest", email }],
      }),
    }]);
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

function createPacket(suffix: string, email: string) {
  return {
    eventId: `event_${suffix}`,
    eventType: "transcript.ready" as const,
    occurredAt: "2026-07-20T18:00:00.000Z",
    sentAt: "2026-07-20T18:01:00.000Z",
    meeting: {
      sourceMeetingId: `meeting_${suffix}`,
      title: "Email matching integration meeting",
      startedAt: "2026-07-20T17:00:00.000Z",
      endedAt: "2026-07-20T18:00:00.000Z",
      durationMinutes: 60,
    },
    attendees: [{ displayName: "Read AI Guest", email }],
    transcript: {
      sourceTranscriptId: `transcript_${suffix}`,
      contentType: "text/plain" as const,
      language: "und",
      content: "Read AI Guest: Integration test transcript.",
      metadata: {
        provider: "read_ai",
        sessionId: suffix,
        requestId: `request_${suffix}`,
        participants: [{ name: "Read AI Guest", email }],
      },
    },
  };
}

async function createLocalProfile(email: string, displayName: string): Promise<{ id: string }> {
  const authResponse = await fetch(new URL("/auth/v1/admin/users", apiUrl), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      email,
      password: `Local-test-${randomUUID()}!`,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    }),
  });
  if (!authResponse.ok) throw new Error(`Local Supabase auth user creation failed with HTTP ${authResponse.status}.`);
  const authUser = await authResponse.json() as { id: string };
  const profileResponse = await fetch(new URL("/rest/v1/profiles", apiUrl), {
    method: "POST",
    headers: { ...serviceHeaders(), prefer: "return=minimal" },
    body: JSON.stringify({
      id: authUser.id,
      account_type: "MEMBER",
      member_role: "USER",
      is_admin: false,
      display_name: displayName,
      email,
      account_status: "ACTIVE",
    }),
  });
  if (!profileResponse.ok) throw new Error(`Local Supabase profile creation failed with HTTP ${profileResponse.status}.`);
  return authUser;
}

async function updateProfileEmail(profileId: string, email: string): Promise<void> {
  const url = new URL("/rest/v1/profiles", apiUrl);
  url.searchParams.set("id", `eq.${profileId}`);
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...serviceHeaders(), prefer: "return=minimal" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(`Local Supabase profile email update failed with HTTP ${response.status}.`);
}

async function attendeeProfileIds(meetingId: string): Promise<string[]> {
  const rows = await selectRows("meeting_attendees", "meeting_id", meetingId, "profile_id") as Array<{
    profile_id: string;
  }>;
  return rows.map((row) => row.profile_id);
}

function serviceHeaders() {
  return {
    "content-type": "application/json",
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
  };
}

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
