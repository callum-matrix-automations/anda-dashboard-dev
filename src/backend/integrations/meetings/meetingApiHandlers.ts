import { z } from "zod";
import type { ServerActor, ServerActorResolver } from "../../auth/serverActor";
import { actorHasPermission, resolveServerActor } from "../../auth/serverActor";
import { meetingApprovalService } from "../../services/approvals/approveMeeting";
import { meetingArchiveService } from "../../services/archive/meetingArchiveService";
import { retryMeetingAnalysis } from "../../services/ai/retryMeetingAnalysis";
import { meetingReviewService } from "../../services/reviews/meetingReviewService";
import { getMeetingSigningSession } from "../../services/signing/getMeetingSigningSession";
import { rejectMeetingSigning } from "../../services/signing/rejectMeetingSigning";
import { retryMeetingSigning } from "../../services/signing/retryMeetingSigning";
import { retryMeetingSigningOutcome } from "../../services/signing/retryMeetingSigningOutcome";
import { apiError, apiValidationError, requireServerActor } from "../http/apiResponses";
import { mapMeetingApiSource } from "./meetingApiSourceMapper";
import type {
  MeetingReviewDetail,
  MeetingReviewAttendeeOption,
  MeetingReviewDraft,
  MeetingReviewMutationResult,
  MeetingReviewSummary,
} from "../../../shared/contracts/meetingReview";
import type {
  MeetingApprovalResult,
  MeetingPdfRetryResult,
} from "../../../shared/contracts/meetingApproval";
import type {
  MeetingSigningRetryResult,
  MeetingSigningSession,
  MeetingSigningSessionRecord,
  RetryMeetingSigningOutcomeResult,
} from "../../../shared/contracts/meetingSigning";
import type { MeetingArchiveSearchResult } from "../../../shared/contracts/meetingArchive";
import type { MeetingAnalysisRetryResult } from "../../../shared/contracts/meetingAnalysisRetry";
import {
  MeetingApiApproveRequestSchema,
  MeetingApiDeferRequestSchema,
  MeetingApiDetailSchema,
  MeetingApiListQuerySchema,
  MeetingApiListResponseSchema,
  MeetingApiMutationResponseSchema,
  MeetingApiRejectSigningRequestSchema,
  MeetingApiSaveDraftRequestSchema,
  MeetingApiSearchQuerySchema,
  MeetingApiSigningSessionSchema,
  MeetingApiSummarySchema,
  MeetingApiVersionedRequestSchema,
  type MeetingApiCapabilities,
  type MeetingApiQueue,
} from "../../../shared/contracts/meetingApi";

type RouteContext = { params: Promise<{ meetingId: string }> };

type SigningRejectionResult = Awaited<ReturnType<typeof rejectMeetingSigning>>;

interface MeetingControllerServices {
  listMeetingReviews(): Promise<MeetingReviewSummary[]>;
  getMeetingReview(meetingId: string): Promise<MeetingReviewDetail | null>;
  listMeetingAttendeeOptions(): Promise<MeetingReviewAttendeeOption[]>;
  saveMeetingDraft(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
    draft: MeetingReviewDraft;
  }): Promise<MeetingReviewMutationResult>;
  deferMeetingReview(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
    note: string;
  }): Promise<MeetingReviewMutationResult>;
  resumeMeetingReview(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<MeetingReviewMutationResult>;
  markMeetingReady(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<MeetingReviewMutationResult>;
  retryMeetingAnalysis(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<MeetingAnalysisRetryResult>;
  approveMeeting(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
    acknowledgeUnresolvedVotes: boolean;
  }): Promise<MeetingApprovalResult>;
  retryMeetingPdf(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<MeetingPdfRetryResult>;
  getMeetingSigningSession(meetingId: string): Promise<
    | MeetingSigningSession
    | Extract<MeetingSigningSessionRecord, { status: "not_found" | "invalid_state" }>
  >;
  retryMeetingSigning(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<MeetingSigningRetryResult>;
  rejectMeetingSigning(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
    comment: string;
  }): Promise<SigningRejectionResult>;
  retryMeetingSigningOutcome(command: {
    meetingId: string;
    expectedVersion: number;
    actorProfileId: string;
  }): Promise<RetryMeetingSigningOutcomeResult & { reconciliation?: unknown }>;
  searchArchive(query: {
    query?: string;
    limit: number;
    offset: number;
  }): Promise<MeetingArchiveSearchResult>;
}

interface ControllerOptions {
  services?: MeetingControllerServices;
  actorResolver?: ServerActorResolver;
}

const defaultServices: MeetingControllerServices = {
  ...meetingReviewService,
  ...meetingApprovalService,
  retryMeetingAnalysis,
  getMeetingSigningSession,
  retryMeetingSigning,
  rejectMeetingSigning,
  retryMeetingSigningOutcome,
  searchArchive: (query) => meetingArchiveService.search(query),
};

export function createMeetingListHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function getMeetingList(request: Request) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const parsedQuery = parseListQuery(new URL(request.url));
    if (parsedQuery instanceof Response) return parsedQuery;

    try {
      const allMeetings = await services.listMeetingReviews();
      const filtered = allMeetings.filter((meeting) => (
        matchesQueue(meeting, parsedQuery.queue)
        && (!parsedQuery.status || meeting.status === parsedQuery.status)
      ));
      const items = filtered
        .slice(parsedQuery.offset, parsedQuery.offset + parsedQuery.limit)
        .map((meeting) => toApiSummary(meeting, auth.actor));
      return Response.json(MeetingApiListResponseSchema.parse({
        items,
        total: filtered.length,
        limit: parsedQuery.limit,
        offset: parsedQuery.offset,
      }));
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createMeetingSearchHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function searchMeetings(request: Request) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const parsedQuery = parseSearchQuery(new URL(request.url));
    if (parsedQuery instanceof Response) return parsedQuery;

    try {
      const [allMeetings, archiveMatches] = await Promise.all([
        services.listMeetingReviews(),
        services.searchArchive({ query: parsedQuery.query, limit: 100, offset: 0 }),
      ]);
      const archiveIds = new Set(archiveMatches.items.map((item) => item.meetingId));
      const needle = parsedQuery.query.toLocaleLowerCase("en");
      const matching = allMeetings.filter((meeting) => (
        archiveIds.has(meeting.id)
        || meeting.title.toLocaleLowerCase("en").includes(needle)
        || meeting.sourceMeetingId.toLocaleLowerCase("en").includes(needle)
        || meeting.meetingDate.includes(needle)
        || meeting.status.toLocaleLowerCase("en").includes(needle)
      ));
      return Response.json(MeetingApiListResponseSchema.parse({
        items: matching
          .slice(parsedQuery.offset, parsedQuery.offset + parsedQuery.limit)
          .map((meeting) => toApiSummary(meeting, auth.actor)),
        total: matching.length,
        limit: parsedQuery.limit,
        offset: parsedQuery.offset,
      }));
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createMeetingDetailHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function getMeetingDetail(request: Request, context: RouteContext) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;
    const meetingId = await parseMeetingId(context);
    if (!meetingId) return invalidMeetingId();

    try {
      const meeting = await services.getMeetingReview(meetingId);
      if (!meeting) return apiError(404, "meeting_not_found", "Meeting was not found.");
      const attendeeOptions = await services.listMeetingAttendeeOptions();
      return Response.json(toApiDetail(meeting, auth.actor, attendeeOptions));
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createSaveMeetingDraftHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function patchMeetingDraft(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiSaveDraftRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.saveMeetingDraft({
        meetingId: prepared.meetingId,
        actorProfileId: prepared.actor.profileId,
        ...prepared.body,
      });
      return mutationResult(result, "draft_saved");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createDeferMeetingHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function deferMeeting(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiDeferRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.deferMeetingReview({
        meetingId: prepared.meetingId,
        actorProfileId: prepared.actor.profileId,
        ...prepared.body,
      });
      return mutationResult(result, "deferred");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createResumeMeetingHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function resumeMeeting(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiVersionedRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.resumeMeetingReview(commandFrom(prepared));
      return mutationResult(result, "resumed");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createMarkMeetingReadyHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function markMeetingReady(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiVersionedRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.markMeetingReady(commandFrom(prepared));
      return mutationResult(result, "marked_ready");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createRetryMeetingAnalysisHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function retryAnalysis(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(
      request,
      context,
      "review",
      MeetingApiVersionedRequestSchema,
      actorResolver,
    );
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.retryMeetingAnalysis(commandFrom(prepared));
      return mutationResult(result, "analysis_retry_completed");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createApproveMeetingHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function approveMeeting(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiApproveRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.approveMeeting({
        meetingId: prepared.meetingId,
        actorProfileId: prepared.actor.profileId,
        ...prepared.body,
      });
      return mutationResult(result, "approved");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createRetryMeetingPdfHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function retryMeetingPdf(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "review", MeetingApiVersionedRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.retryMeetingPdf(commandFrom(prepared));
      return mutationResult(result, "pdf_retry_started");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createMeetingSigningSessionHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function getSigningSession(request: Request, context: RouteContext) {
    const auth = await requireServerActor(request, "sign", actorResolver);
    if ("response" in auth) return auth.response;
    const meetingId = await parseMeetingId(context);
    if (!meetingId) return invalidMeetingId();
    try {
      const result = await services.getMeetingSigningSession(meetingId);
      if (result.status !== "available") {
        if (result.status === "not_found") {
          return apiError(404, "meeting_not_found", "Meeting was not found.");
        }
        return apiError(409, "invalid_meeting_state", "Meeting is not ready for signing.");
      }
      return Response.json(MeetingApiSigningSessionSchema.parse({
        meetingId: result.meetingId,
        documentVersion: result.documentVersion,
        providerStatus: result.providerStatus,
        recipientEmail: result.recipientEmail,
        signingUrl: result.signingUrl,
      }), { headers: { "cache-control": "no-store" } });
    } catch {
      return apiError(503, "signing_session_unavailable", "The signing session is unavailable.");
    }
  };
}

export function createRetryMeetingSigningHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function retrySigning(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "sign", MeetingApiVersionedRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.retryMeetingSigning(commandFrom(prepared));
      return mutationResult(result, "signing_retry_started");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createRejectMeetingSigningHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function rejectSigning(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "sign", MeetingApiRejectSigningRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.rejectMeetingSigning({
        meetingId: prepared.meetingId,
        actorProfileId: prepared.actor.profileId,
        ...prepared.body,
      });
      return mutationResult(result, "signing_rejected");
    } catch {
      return serviceUnavailable();
    }
  };
}

export function createRetryMeetingSigningOutcomeHandler(options: ControllerOptions = {}) {
  const { services, actorResolver } = resolveOptions(options);
  return async function retrySigningOutcome(request: Request, context: RouteContext) {
    const prepared = await prepareMutation(request, context, "sign", MeetingApiVersionedRequestSchema, actorResolver);
    if ("response" in prepared) return prepared.response;
    try {
      const result = await services.retryMeetingSigningOutcome(commandFrom(prepared));
      return mutationResult(result, "signing_outcome_retry_started");
    } catch {
      return serviceUnavailable();
    }
  };
}

function resolveOptions(options: ControllerOptions) {
  return {
    services: options.services ?? defaultServices,
    actorResolver: options.actorResolver ?? resolveServerActor,
  };
}

function parseListQuery(url: URL) {
  const unknown = unknownQueryParameters(url, ["queue", "status", "limit", "offset"]);
  if (unknown) return unknown;
  const parsed = MeetingApiListQuerySchema.safeParse({
    queue: url.searchParams.get("queue")?.trim() || "all",
    status: url.searchParams.get("status")?.trim() || undefined,
    limit: parseInteger(url.searchParams.get("limit")) ?? 25,
    offset: parseInteger(url.searchParams.get("offset")) ?? 0,
  });
  return parsed.success ? parsed.data : apiValidationError(parsed.error, "Meeting list filters are invalid.");
}

function parseSearchQuery(url: URL) {
  const unknown = unknownQueryParameters(url, ["q", "limit", "offset"]);
  if (unknown) return unknown;
  const parsed = MeetingApiSearchQuerySchema.safeParse({
    query: url.searchParams.get("q") ?? "",
    limit: parseInteger(url.searchParams.get("limit")) ?? 25,
    offset: parseInteger(url.searchParams.get("offset")) ?? 0,
  });
  return parsed.success ? parsed.data : apiValidationError(parsed.error, "Meeting search parameters are invalid.");
}

function unknownQueryParameters(url: URL, allowed: string[]) {
  const allowedSet = new Set(allowed);
  const unknown = [...url.searchParams.keys()].filter((key) => !allowedSet.has(key));
  const duplicated = allowed.filter((key) => url.searchParams.getAll(key).length > 1);
  if (!unknown.length && !duplicated.length) return null;
  return apiError(400, "invalid_request", "Query parameters are invalid.", {
    issues: [
      ...unknown.map((key) => ({ path: key, message: "Unknown query parameter." })),
      ...duplicated.map((key) => ({ path: key, message: "Query parameter must appear once." })),
    ],
  });
}

function parseInteger(value: string | null) {
  if (value === null || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function matchesQueue(meeting: MeetingReviewSummary, queue: MeetingApiQueue) {
  if (queue === "all") return true;
  if (queue === "deferred") return meeting.deferredAt !== null;
  if (queue === "archive") return meeting.status === "COMPLETED";
  if (queue === "signing") {
    return ["AWAITING_SIGNATURE", "ESIGN_FAILED", "ARCHIVE_FAILED"].includes(meeting.status);
  }
  return meeting.deferredAt === null && [
    "AI_PROCESSING",
    "AI_FAILED",
    "PENDING_APPROVAL",
    "PDF_PROCESSING",
    "PDF_FAILED",
  ].includes(meeting.status);
}

function toApiSummary(meeting: MeetingReviewSummary, actor: ServerActor) {
  return MeetingApiSummarySchema.parse({
    id: meeting.id,
    sourceMeetingId: meeting.sourceMeetingId,
    title: meeting.title,
    category: meeting.category,
    meetingDate: meeting.meetingDate,
    durationMinutes: meeting.durationMinutes,
    status: meeting.status,
    version: meeting.version,
    deferredAt: meeting.deferredAt,
    deferredNote: meeting.deferredNote,
    humanOwned: meeting.humanOwned,
    failure: meeting.failure,
    approval: meeting.approval,
    pdfArtifact: meeting.pdfArtifact ? {
      id: meeting.pdfArtifact.id,
      sizeBytes: meeting.pdfArtifact.sizeBytes,
      pageCount: meeting.pdfArtifact.pageCount,
      generatedAt: meeting.pdfArtifact.generatedAt,
      documentVersion: meeting.pdfArtifact.documentVersion,
    } : null,
    pdfAttempt: meeting.pdfAttempt,
    updatedAt: meeting.updatedAt,
    capabilities: capabilitiesFor(meeting, actor),
  });
}

function toApiDetail(
  meeting: MeetingReviewDetail,
  actor: ServerActor,
  attendeeOptions: MeetingReviewAttendeeOption[],
) {
  const safeAttendeeOptions = new Map(attendeeOptions.map((option) => [option.profileId, option]));
  meeting.attendees.forEach((attendee) => safeAttendeeOptions.set(attendee.profileId, {
    profileId: attendee.profileId,
    displayName: attendee.displayName,
  }));
  return MeetingApiDetailSchema.parse({
    ...toApiSummary(meeting, actor),
    tags: meeting.tags,
    minutes: meeting.minutes,
    transcript: {
      id: meeting.transcript.id,
      sourceTranscriptId: meeting.transcript.sourceTranscriptId,
      content: meeting.transcript.content,
      importedAt: meeting.transcript.importedAt,
    },
    ...mapMeetingApiSource(meeting),
    attendeeOptions: [...safeAttendeeOptions.values()].sort((left, right) => left.displayName.localeCompare(right.displayName)),
    attendees: meeting.attendees.map((attendee) => ({
      attendeeId: attendee.attendeeId,
      profileId: attendee.profileId,
      displayName: attendee.displayName,
    })),
    motions: meeting.motions,
    history: meeting.history,
  });
}

function capabilitiesFor(meeting: MeetingReviewSummary, actor: ServerActor): MeetingApiCapabilities {
  const reviewer = actorHasPermission(actor, "review");
  const signer = actorHasPermission(actor, "sign");
  const editableState = meeting.status === "AI_FAILED" || meeting.status === "PENDING_APPROVAL";
  const activeReview = editableState && meeting.deferredAt === null && meeting.approval === null;
  return {
    canEdit: reviewer && activeReview,
    canDefer: reviewer && activeReview,
    canResume: reviewer && editableState && meeting.deferredAt !== null && meeting.approval === null,
    canMarkReady: reviewer && meeting.status === "AI_FAILED" && meeting.deferredAt === null && meeting.approval === null,
    canRetryAnalysis: reviewer
      && meeting.status === "AI_FAILED"
      && meeting.deferredAt === null
      && meeting.approval === null
      && !meeting.humanOwned,
    canApprove: reviewer && meeting.status === "PENDING_APPROVAL" && meeting.deferredAt === null && meeting.approval === null,
    canRetryPdf: reviewer && meeting.status === "PDF_FAILED",
    canOpenSigningSession: signer && meeting.status === "AWAITING_SIGNATURE",
    canRetrySigning: signer && meeting.status === "ESIGN_FAILED",
    canRejectSigning: signer && (meeting.status === "AWAITING_SIGNATURE" || meeting.status === "ESIGN_FAILED"),
    canRetrySigningOutcome: signer && (meeting.status === "AWAITING_SIGNATURE" || meeting.status === "ESIGN_FAILED"),
    canDownloadArchive: meeting.status === "COMPLETED",
  };
}

async function parseMeetingId(context: RouteContext) {
  const parsed = z.string().uuid().safeParse((await context.params).meetingId);
  return parsed.success ? parsed.data : null;
}

function invalidMeetingId() {
  return apiError(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
}

async function prepareMutation<T>(
  request: Request,
  context: RouteContext,
  permission: "review" | "sign",
  schema: z.ZodType<T>,
  actorResolver: ServerActorResolver,
): Promise<
  | { actor: ServerActor; meetingId: string; body: T }
  | { response: Response }
> {
  const auth = await requireServerActor(request, permission, actorResolver);
  if ("response" in auth) return auth;
  const meetingId = await parseMeetingId(context);
  if (!meetingId) return { response: invalidMeetingId() };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: apiError(400, "invalid_json", "Request body must contain valid JSON.") };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: apiValidationError(parsed.error) };
  return { actor: auth.actor, meetingId, body: parsed.data };
}

function commandFrom(prepared: {
  actor: ServerActor;
  meetingId: string;
  body: { expectedVersion: number };
}) {
  return {
    meetingId: prepared.meetingId,
    expectedVersion: prepared.body.expectedVersion,
    actorProfileId: prepared.actor.profileId,
  };
}

function mutationResult(
  result: {
    status: string;
    meetingId?: string | null;
    version?: number | null;
    documentVersion?: number | null;
    unresolvedVoteCount?: number;
    attempt?: number | null;
  },
  action: z.infer<typeof MeetingApiMutationResponseSchema>["action"],
) {
  if (!isSuccessfulActionResult(action, result.status)) {
    return domainResultError(result);
  }
  if (!result.meetingId) return serviceUnavailable();
  return Response.json(MeetingApiMutationResponseSchema.parse({
    action,
    meetingId: result.meetingId,
    version: result.version ?? null,
    ...(result.documentVersion === undefined ? {} : { documentVersion: result.documentVersion }),
    ...(result.unresolvedVoteCount === undefined ? {} : {
      unresolvedVoteCount: result.unresolvedVoteCount,
    }),
    ...(result.attempt === undefined || result.attempt === null ? {} : { attempt: result.attempt }),
  }));
}

function isSuccessfulActionResult(
  action: z.infer<typeof MeetingApiMutationResponseSchema>["action"],
  status: string,
) {
  const expectedStatus: Record<typeof action, string> = {
    draft_saved: "saved",
    deferred: "deferred",
    resumed: "resumed",
    marked_ready: "ready",
    analysis_retry_completed: "completed",
    approved: "approved",
    pdf_retry_started: "retry_started",
    signing_retry_started: "retry_started",
    signing_rejected: "rejected",
    signing_outcome_retry_started: "retry_started",
  };
  return status === expectedStatus[action];
}

function domainResultError(result: {
  status: string;
  version?: number | null;
  unresolvedVoteCount?: number;
}) {
  const details = {
    currentVersion: result.version,
    ...(result.unresolvedVoteCount === undefined ? {} : {
      unresolvedVoteCount: result.unresolvedVoteCount,
    }),
  };
  switch (result.status) {
    case "not_found":
      return apiError(404, "meeting_not_found", "Meeting was not found.");
    case "forbidden":
    case "invalid_actor":
      return apiError(403, "insufficient_role", "Your account cannot perform this action.");
    case "conflict":
    case "stale":
      return apiError(409, "version_conflict", "Meeting changed after it was loaded.", details);
    case "protected":
      return apiError(409, "meeting_protected", "Meeting content is protected from this action.", details);
    case "deferred":
      return apiError(409, "meeting_deferred", "Deferred meeting must be resumed first.", details);
    case "invalid_state":
      return apiError(409, "invalid_meeting_state", "Meeting is not in a valid state for this action.", details);
    case "acknowledgement_required":
      return apiError(409, "unresolved_votes_acknowledgement_required", "Unresolved votes must be acknowledged.", details);
    case "invalid_content":
      return apiError(422, "invalid_meeting_content", "Meeting content is not ready for this action.", details);
    case "comment_required":
      return apiError(400, "comment_required", "A rejection comment is required.", details);
    case "failed":
      return apiError(502, "workflow_action_failed", "The external workflow action failed.", details);
    default:
      return serviceUnavailable();
  }
}

function serviceUnavailable() {
  return apiError(503, "meeting_service_unavailable", "Meeting service is unavailable.");
}
