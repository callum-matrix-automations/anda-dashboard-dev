import { z } from "zod";
import type {
  ActiveMemberProfile,
  StoredTranscriptImport,
  TranscriptImportRecord,
  TranscriptImportFailureRepository,
  TranscriptRepository,
} from "../transcripts/transcriptRepository";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

const TranscriptImportRpcRowSchema = z.object({
  ingestion_status: z.enum(["received", "duplicate"]),
  meeting_id: z.string().uuid(),
  transcript_id: z.string().uuid(),
  imported_at: z.string().datetime({ offset: true }),
});

const ActiveMemberProfileRowSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().trim().min(1),
  email: z.string().trim().min(1),
});
const LinkedManualAttendeeCountSchema = z.number().int().nonnegative();

interface SupabaseTranscriptRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

export class TranscriptRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = "TranscriptRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseTranscriptRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseTranscriptRepositoryOptions = {}): TranscriptRepository & TranscriptImportFailureRepository {
  return {
    async listActiveMemberProfiles(): Promise<ActiveMemberProfile[]> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const profilesUrl = new URL("/rest/v1/profiles", configuration.apiUrl);
      profilesUrl.searchParams.set("select", "id,display_name,email");
      profilesUrl.searchParams.set("account_type", "eq.MEMBER");
      profilesUrl.searchParams.set("account_status", "eq.ACTIVE");
      profilesUrl.searchParams.set("email", "not.is.null");

      const responseBody = await requestSupabase({
        url: profilesUrl,
        secretKey: configuration.secretKey,
        fetchImplementation: configuration.fetchImplementation,
      });
      const parsed = z.array(ActiveMemberProfileRowSchema).safeParse(responseBody);
      if (!parsed.success) {
        throw new TranscriptRepositoryError("Supabase returned an invalid active profile response.", {
          code: "invalid_supabase_response",
        });
      }

      return parsed.data.map((profile) => ({
        profileId: profile.id,
        displayName: profile.display_name,
        email: profile.email,
      }));
    },

    async storeImport(record: TranscriptImportRecord): Promise<StoredTranscriptImport> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);

      const rpcUrl = new URL("/rest/v1/rpc/ingest_transcript_webhook", configuration.apiUrl);
      let response: Response;
      try {
        response = await configuration.fetchImplementation(rpcUrl, {
          method: "POST",
          headers: supabaseServerHeaders(configuration.secretKey, {
            "content-type": "application/json",
            accept: "application/json",
          }),
          body: JSON.stringify({
            p_source_meeting_id: record.sourceMeetingId,
            p_title: record.title,
            p_meeting_date: record.meetingDate,
            p_duration_minutes: record.durationMinutes,
            p_source_transcript_id: record.sourceTranscriptId,
            p_content: record.content,
            p_metadata: record.metadata ?? {},
            p_attendees: record.attendees.map((attendee) => ({
              profile_id: attendee.profileId,
              display_name_snapshot: attendee.displayNameSnapshot,
              source_email_snapshot: attendee.sourceEmailSnapshot,
            })),
          }),
        });
      } catch (error) {
        throw new TranscriptRepositoryError("Supabase transcript persistence request failed.", {
          code: "supabase_request_failed",
          cause: error,
        });
      }

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        const details = SupabaseErrorSchema.safeParse(responseBody);
        throw new TranscriptRepositoryError(
          details.success ? details.data.message : `Supabase transcript persistence returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: details.success ? details.data.code : "supabase_response_failed",
          },
        );
      }

      const parsed = z.array(TranscriptImportRpcRowSchema).length(1).safeParse(responseBody);
      if (!parsed.success) {
        throw new TranscriptRepositoryError("Supabase returned an invalid transcript persistence response.", {
          status: response.status,
          code: "invalid_supabase_response",
        });
      }

      const stored = parsed.data[0];
      if (!stored) {
        throw new TranscriptRepositoryError("Supabase returned an empty transcript persistence response.", {
          status: response.status,
          code: "invalid_supabase_response",
        });
      }
      return {
        status: stored.ingestion_status === "received" ? "stored" : "duplicate",
        meetingId: stored.meeting_id,
        transcriptId: stored.transcript_id,
        importedAt: stored.imported_at,
      };
    },

    async linkManualAttendees(meetingId, attendees): Promise<number> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const rpcUrl = new URL("/rest/v1/rpc/link_manual_transcript_attendees", configuration.apiUrl);
      const responseBody = await requestSupabaseMutation({
        url: rpcUrl,
        secretKey: configuration.secretKey,
        fetchImplementation: configuration.fetchImplementation,
        body: {
          p_meeting_id: meetingId,
          p_attendees: attendees.map((attendee) => ({
            profile_id: attendee.profileId,
            display_name_snapshot: attendee.displayNameSnapshot,
          })),
        },
        operation: "manual transcript attendee linking",
        returnResponse: true,
      });
      const parsed = LinkedManualAttendeeCountSchema.safeParse(responseBody);
      if (!parsed.success) {
        throw new TranscriptRepositoryError("Supabase returned an invalid manual attendee link response.", {
          code: "invalid_supabase_response",
        });
      }
      return parsed.data;
    },

    async resolveUnmatchedParticipants(meetingId): Promise<number> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const rpcUrl = new URL("/rest/v1/rpc/resolve_unmatched_transcript_participants", configuration.apiUrl);
      let response: Response;
      try {
        response = await configuration.fetchImplementation(rpcUrl, {
          method: "POST",
          headers: supabaseServerHeaders(configuration.secretKey, {
            "content-type": "application/json",
            accept: "application/json",
          }),
          body: JSON.stringify({ p_meeting_id: meetingId }),
        });
      } catch (error) {
        throw new TranscriptRepositoryError("Supabase participant resolution request failed.", {
          code: "supabase_request_failed",
          cause: error,
        });
      }

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        const details = SupabaseErrorSchema.safeParse(responseBody);
        throw new TranscriptRepositoryError(
          details.success ? details.data.message : `Supabase participant resolution returned HTTP ${response.status}.`,
          {
            status: response.status,
            code: details.success ? details.data.code : "supabase_response_failed",
          },
        );
      }
      const parsed = z.number().int().nonnegative().safeParse(responseBody);
      if (!parsed.success) {
        throw new TranscriptRepositoryError("Supabase returned an invalid participant resolution result.", {
          status: response.status,
          code: "invalid_supabase_response",
        });
      }
      return parsed.data;
    },

    async recordFailure(record): Promise<void> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const rpcUrl = new URL("/rest/v1/rpc/record_transcript_import_failure", configuration.apiUrl);
      await requestSupabaseMutation({
        url: rpcUrl,
        secretKey: configuration.secretKey,
        fetchImplementation: configuration.fetchImplementation,
        body: {
          p_source_provider: record.sourceProvider,
          p_source_meeting_id: record.sourceMeetingId,
          p_request_id: record.requestId,
          p_title: record.title,
          p_platform_meeting_id: record.platformMeetingId,
          p_error_code: record.errorCode,
          p_error_message: record.errorMessage,
          p_attempts: record.attempts,
          p_failed_at: record.failedAt,
        },
        operation: "transcript import failure alert",
      });
    },

    async resolveFailure(sourceProvider, sourceMeetingId, resolvedAt): Promise<void> {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const rpcUrl = new URL("/rest/v1/rpc/resolve_transcript_import_failure", configuration.apiUrl);
      await requestSupabaseMutation({
        url: rpcUrl,
        secretKey: configuration.secretKey,
        fetchImplementation: configuration.fetchImplementation,
        body: {
          p_source_provider: sourceProvider,
          p_source_meeting_id: sourceMeetingId,
          p_resolved_at: resolvedAt,
        },
        operation: "transcript import failure resolution",
      });
    },
  };
}

async function requestSupabaseMutation({
  url,
  secretKey,
  fetchImplementation,
  body,
  operation,
  returnResponse = false,
}: {
  url: URL;
  secretKey: string;
  fetchImplementation: typeof fetch;
  body: Record<string, unknown>;
  operation: string;
  returnResponse?: boolean;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: supabaseServerHeaders(secretKey, {
        "content-type": "application/json",
        accept: "application/json",
      }),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new TranscriptRepositoryError(`Supabase ${operation} request failed.`, {
      code: "supabase_request_failed",
      cause: error,
    });
  }
  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    const details = SupabaseErrorSchema.safeParse(responseBody);
    throw new TranscriptRepositoryError(
      details.success ? details.data.message : `Supabase ${operation} returned HTTP ${response.status}.`,
      { status: response.status, code: details.success ? details.data.code : "supabase_response_failed" },
    );
  }
  return returnResponse ? responseBody : undefined;
}

function resolveConfiguration(
  apiUrl: string | undefined,
  secretKey: string | undefined,
  fetchImplementation: typeof fetch,
) {
  const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!resolvedApiUrl || !resolvedSecretKey) {
    throw new TranscriptRepositoryError("Supabase transcript persistence is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new TranscriptRepositoryError("A fetch implementation is required for Supabase persistence.", {
      code: "fetch_not_configured",
    });
  }
  return {
    apiUrl: resolvedApiUrl,
    secretKey: resolvedSecretKey,
    fetchImplementation,
  };
}

async function requestSupabase({
  url,
  secretKey,
  fetchImplementation,
}: {
  url: URL;
  secretKey: string;
  fetchImplementation: typeof fetch;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: supabaseServerHeaders(secretKey, {
        accept: "application/json",
      }),
    });
  } catch (error) {
    throw new TranscriptRepositoryError("Supabase profile request failed.", {
      code: "supabase_request_failed",
      cause: error,
    });
  }

  const responseBody = await readResponseBody(response);
  if (!response.ok) {
    const details = SupabaseErrorSchema.safeParse(responseBody);
    throw new TranscriptRepositoryError(
      details.success ? details.data.message : `Supabase profile request returned HTTP ${response.status}.`,
      {
        status: response.status,
        code: details.success ? details.data.code : "supabase_response_failed",
      },
    );
  }
  return responseBody;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export const supabaseTranscriptRepository = createSupabaseTranscriptRepository();
