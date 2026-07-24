import { z } from "zod";
import type { MeetingReviewRepository } from "../reviews/meetingReviewRepository";
import {
  MeetingReviewAttendeeOptionSchema,
  MeetingReviewDetailSchema,
  MeetingReviewMutationResultSchema,
  MeetingReviewSummarySchema,
} from "../../../shared/contracts/meetingReview";
import { supabaseServerHeaders } from "./supabaseServerHeaders";

interface SupabaseMeetingReviewRepositoryOptions {
  apiUrl?: string;
  secretKey?: string;
  fetchImplementation?: typeof fetch;
}

const SupabaseErrorSchema = z.object({
  code: z.string().optional(),
  message: z.string(),
});

const StoredAttendeeOptionSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().trim().min(1),
}).strict();

export class MeetingReviewRepositoryError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, { status, code, cause }: { status?: number; code?: string; cause?: unknown } = {}) {
    super(message, { cause });
    this.name = "MeetingReviewRepositoryError";
    this.status = status;
    this.code = code;
  }
}

export function createSupabaseMeetingReviewRepository({
  apiUrl,
  secretKey,
  fetchImplementation = globalThis.fetch,
}: SupabaseMeetingReviewRepositoryOptions = {}): MeetingReviewRepository {
  async function callRpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
    const rpcUrl = new URL(`/rest/v1/rpc/${name}`, configuration.apiUrl);
    let response: Response;
    try {
      response = await configuration.fetchImplementation(rpcUrl, {
        method: "POST",
        headers: supabaseServerHeaders(configuration.secretKey, {
          "content-type": "application/json",
          accept: "application/json",
        }),
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new MeetingReviewRepositoryError("Supabase meeting review request failed.", {
        code: "supabase_request_failed",
        cause: error,
      });
    }

    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const details = SupabaseErrorSchema.safeParse(responseBody);
      throw new MeetingReviewRepositoryError(
        details.success ? details.data.message : `Supabase meeting review returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: details.success ? details.data.code : "supabase_response_failed",
        },
      );
    }
    return responseBody;
  }

  function parseMutation(value: unknown) {
    const parsed = MeetingReviewMutationResultSchema.safeParse(value);
    if (!parsed.success) {
      throw new MeetingReviewRepositoryError("Supabase returned an invalid meeting review mutation result.", {
        code: "invalid_supabase_response",
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  return {
    async listReviews() {
      const responseBody = await callRpc("list_meeting_reviews", {});
      const parsed = MeetingReviewSummarySchema.array().safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingReviewRepositoryError("Supabase returned an invalid meeting review list.", {
          code: "invalid_supabase_response",
          cause: parsed.error,
        });
      }
      return parsed.data;
    },

    async getReview(meetingId) {
      const responseBody = await callRpc("get_meeting_review", { p_meeting_id: meetingId });
      const parsed = MeetingReviewDetailSchema.nullable().safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingReviewRepositoryError("Supabase returned an invalid meeting review detail.", {
          code: "invalid_supabase_response",
          cause: parsed.error,
        });
      }
      return parsed.data;
    },

    async listAttendeeOptions() {
      const configuration = resolveConfiguration(apiUrl, secretKey, fetchImplementation);
      const profilesUrl = new URL("/rest/v1/profiles", configuration.apiUrl);
      profilesUrl.searchParams.set("select", "id,display_name");
      profilesUrl.searchParams.set("account_type", "eq.MEMBER");
      profilesUrl.searchParams.set("account_status", "eq.ACTIVE");
      profilesUrl.searchParams.set("order", "display_name.asc,id.asc");

      let response: Response;
      try {
        response = await configuration.fetchImplementation(profilesUrl, {
          headers: supabaseServerHeaders(configuration.secretKey, {
            accept: "application/json",
          }),
        });
      } catch (error) {
        throw new MeetingReviewRepositoryError("Supabase attendee options request failed.", {
          code: "supabase_request_failed",
          cause: error,
        });
      }

      const responseBody = await readResponseBody(response);
      if (!response.ok) {
        throw new MeetingReviewRepositoryError("Supabase attendee options request failed.", {
          status: response.status,
          code: "supabase_response_failed",
        });
      }
      const parsed = StoredAttendeeOptionSchema.array().safeParse(responseBody);
      if (!parsed.success) {
        throw new MeetingReviewRepositoryError("Supabase returned invalid attendee options.", {
          code: "invalid_supabase_response",
          cause: parsed.error,
        });
      }
      return MeetingReviewAttendeeOptionSchema.array().parse(parsed.data.map((profile) => ({
        profileId: profile.id,
        displayName: profile.display_name,
      })));
    },

    async saveDraft(command) {
      return parseMutation(await callRpc("save_meeting_review_draft", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
        p_draft: command.draft,
      }));
    },

    async deferReview(command) {
      return parseMutation(await callRpc("defer_meeting_review", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
        p_note: command.note,
      }));
    },

    async resumeReview(command) {
      return parseMutation(await callRpc("resume_meeting_review", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
      }));
    },

    async markReady(command) {
      return parseMutation(await callRpc("mark_meeting_ready", {
        p_meeting_id: command.meetingId,
        p_expected_version: command.expectedVersion,
        p_actor_profile_id: command.actorProfileId,
      }));
    },
  };
}

function resolveConfiguration(
  apiUrl: string | undefined,
  secretKey: string | undefined,
  fetchImplementation: typeof fetch,
) {
  const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
  if (!resolvedApiUrl || !resolvedSecretKey) {
    throw new MeetingReviewRepositoryError("Supabase meeting review persistence is not configured.", {
      code: "supabase_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new MeetingReviewRepositoryError("A fetch implementation is required for Supabase meeting reviews.", {
      code: "fetch_not_configured",
    });
  }
  return {
    apiUrl: resolvedApiUrl,
    secretKey: resolvedSecretKey,
    fetchImplementation,
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export const supabaseMeetingReviewRepository = createSupabaseMeetingReviewRepository();
