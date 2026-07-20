import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
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
  secret = configuredArchiveSecret(),
}: { service?: ArchiveReadService; secret?: string } = {}) {
  return async function getArchiveList(request: Request) {
    const auth = authenticate(request, secret);
    if (auth) return auth;
    const parsed = parseQuery(new URL(request.url));
    if (!parsed.success) return validationResponse(parsed.error);
    try {
      return Response.json(await service.search(parsed.data));
    } catch {
      return errorResponse(503, "archive_unavailable", "The completed meeting archive is unavailable.");
    }
  };
}

export function createArchiveDetailHandler({
  service = meetingArchiveService,
  secret = configuredArchiveSecret(),
}: { service?: ArchiveReadService; secret?: string } = {}) {
  return async function getArchiveDetail(request: Request, context: RouteContext) {
    const auth = authenticate(request, secret);
    if (auth) return auth;
    const meetingId = await validatedMeetingId(context);
    if (!meetingId) return errorResponse(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
    try {
      const result = await service.get(meetingId);
      if (result.status === "not_found") {
        return errorResponse(404, "archive_not_found", "Completed meeting archive was not found.");
      }
      return Response.json(result.archive);
    } catch {
      return errorResponse(503, "archive_unavailable", "The completed meeting archive is unavailable.");
    }
  };
}

export function createArchiveDocumentHandler({
  service = meetingArchiveService,
  secret = configuredArchiveSecret(),
}: { service?: ArchiveReadService; secret?: string } = {}) {
  return async function getArchiveDocument(request: Request, context: RouteContext) {
    const auth = authenticate(request, secret);
    if (auth) return auth;
    const meetingId = await validatedMeetingId(context);
    if (!meetingId) return errorResponse(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
    try {
      const result = await service.createDocumentAccess(meetingId);
      if (result.status === "not_found") {
        return errorResponse(404, "archive_not_found", "Completed meeting archive was not found.");
      }
      return Response.json(result.access, {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return errorResponse(503, "document_access_unavailable", "Temporary document access is unavailable.");
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
    const auth = authenticate(request, secret);
    if (auth) return auth;
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return errorResponse(400, "invalid_json", "Recovery request must contain valid JSON.");
    }
    const parsed = z.object({ limit: z.number().int().min(1).max(100).optional() }).strict().safeParse(body);
    if (!parsed.success) return validationResponse(parsed.error);
    try {
      return Response.json(await recover(parsed.data.limit));
    } catch {
      return errorResponse(503, "archive_recovery_failed", "Archive recovery could not be completed.");
    }
  };
}

function parseQuery(url: URL) {
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

function authenticate(request: Request, secret: string | undefined) {
  if (!secret?.trim()) {
    return errorResponse(503, "archive_auth_not_configured", "Archive API authentication is not configured.");
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return errorResponse(401, "invalid_authorization", "A valid archive bearer token is required.");
  }
  const supplied = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret.trim(), "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return errorResponse(401, "invalid_authorization", "A valid archive bearer token is required.");
  }
  return null;
}

function validationResponse(error: z.ZodError) {
  return Response.json({
    error: "invalid_archive_request",
    message: "Archive request parameters are invalid.",
    issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  }, { status: 400 });
}

function errorResponse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}
