import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resolveServerActor, type ServerActorResolver } from "../../auth/serverActor";
import { apiError, apiValidationError, requireServerActor } from "../http/apiResponses";
import type {
  MeetingArchiveDetail,
  MeetingArchiveQuery,
  MeetingArchiveSearchResult,
} from "../../../shared/contracts/meetingArchive";
import { MeetingArchiveCategorySchema, MeetingArchiveQuerySchema } from "../../../shared/contracts/meetingArchive";
import { meetingArchiveService } from "../../services/archive/meetingArchiveService";
import { recoverMeetingArchives } from "../../services/archive/recoverMeetingArchives";

type RouteContext = { params: Promise<{ meetingId: string }> };

interface ArchiveReadService {
  search(query: MeetingArchiveQuery): Promise<MeetingArchiveSearchResult>;
  get(meetingId: string): Promise<
    | { status: "available"; archive: MeetingArchiveDetail }
    | { status: "not_found"; meetingId: string }
  >;
  createDocumentAccess(meetingId: string): Promise<
    | {
      status: "available";
      access: { meetingId: string; pdfId: string; url: string; expiresAt: string };
    }
    | { status: "not_found"; meetingId: string }
  >;
}

export function createArchiveListHandler({
  service = meetingArchiveService,
  actorResolver = resolveServerActor,
}: { service?: ArchiveReadService; actorResolver?: ServerActorResolver } = {}) {
  return async function getArchiveList(request: Request) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const parsed = parseQuery(new URL(request.url));
    if (parsed instanceof Response) return parsed;
    if (!parsed.success) return apiValidationError(parsed.error, "Archive request parameters are invalid.");
    try {
      return Response.json(await service.search(parsed.data));
    } catch {
      return apiError(503, "archive_unavailable", "The completed meeting archive is unavailable.");
    }
  };
}

export function createArchiveDetailHandler({
  service = meetingArchiveService,
  actorResolver = resolveServerActor,
}: { service?: ArchiveReadService; actorResolver?: ServerActorResolver } = {}) {
  return async function getArchiveDetail(request: Request, context: RouteContext) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const meetingId = await validatedMeetingId(context);
    if (!meetingId) return apiError(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
    try {
      const result = await service.get(meetingId);
      if (result.status === "not_found") {
        return apiError(404, "archive_not_found", "Completed meeting archive was not found.");
      }
      return Response.json(result.archive);
    } catch {
      return apiError(503, "archive_unavailable", "The completed meeting archive is unavailable.");
    }
  };
}

export function createArchiveDocumentHandler({
  service = meetingArchiveService,
  actorResolver = resolveServerActor,
}: { service?: ArchiveReadService; actorResolver?: ServerActorResolver } = {}) {
  return async function getArchiveDocument(request: Request, context: RouteContext) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const meetingId = await validatedMeetingId(context);
    if (!meetingId) return apiError(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
    try {
      const result = await service.createDocumentAccess(meetingId);
      if (result.status === "not_found") {
        return apiError(404, "archive_not_found", "Completed meeting archive was not found.");
      }
      return Response.json(result.access, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return apiError(503, "document_access_unavailable", "Temporary document access is unavailable.");
    }
  };
}

export function createArchiveRecoveryHandler({
  recover = recoverMeetingArchives,
  secret = configuredArchiveSecret(),
}: {
  recover?: (limit?: number) => Promise<unknown>;
  secret?: string;
} = {}) {
  return async function postArchiveRecovery(request: Request) {
    const auth = authenticateSecret(request, secret);
    if (auth) return auth;
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return apiError(400, "invalid_json", "Recovery request must contain valid JSON.");
    }
    const parsed = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict().safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "Archive recovery request is invalid.");
    try {
      return Response.json(await recover(parsed.data.limit));
    } catch {
      return apiError(503, "archive_recovery_failed", "Archive recovery could not be completed.");
    }
  };
}

function parseQuery(url: URL) {
  const allowed = new Set(["q", "year", "category", "limit", "offset"]);
  const unknown = [...url.searchParams.keys()].filter((key) => !allowed.has(key));
  const duplicated = [...allowed].filter((key) => url.searchParams.getAll(key).length > 1);
  if (unknown.length || duplicated.length) {
    return apiError(400, "invalid_request", "Archive query parameters are invalid.", {
      issues: [
        ...unknown.map((key) => ({ path: key, message: "Unknown query parameter." })),
        ...duplicated.map((key) => ({ path: key, message: "Query parameter must appear once." })),
      ],
    });
  }
  const year = parseInteger(url.searchParams.get("year"));
  const limit = parseInteger(url.searchParams.get("limit"));
  const offset = parseInteger(url.searchParams.get("offset"));
  const categoryValue = url.searchParams.get("category")?.trim() || undefined;
  const category = categoryValue === undefined
    ? undefined
    : MeetingArchiveCategorySchema.safeParse(categoryValue);
  if (category && !category.success) return category;
  return MeetingArchiveQuerySchema.safeParse({
    query: url.searchParams.get("q")?.trim() || undefined,
    year: year ?? undefined,
    category: category?.data,
    limit: limit ?? 25,
    offset: offset ?? 0,
  });
}

function configuredArchiveSecret() {
  return process.env.ARCHIVE_API_SECRET ?? process.env.INTERNAL_ANALYSIS_SECRET;
}

function parseInteger(value: string | null) {
  if (value === null || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

async function validatedMeetingId(context: RouteContext) {
  const parsed = z.string().uuid().safeParse((await context.params).meetingId);
  return parsed.success ? parsed.data : null;
}

function authenticateSecret(request: Request, secret: string | undefined) {
  if (!secret?.trim()) {
    return apiError(503, "archive_auth_not_configured", "Archive API authentication is not configured.");
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return apiError(401, "invalid_authorization", "A valid archive bearer token is required.");
  }
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret.trim(), "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return apiError(401, "invalid_authorization", "A valid archive bearer token is required.");
  }
  return null;
}
