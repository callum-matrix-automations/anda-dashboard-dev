import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { resolveServerActor, type ServerActorResolver } from "../../auth/serverActor";
import { reportOperationalIssue } from "../../services/operations/reportOperationalIssue";
import {
  configuredOperationalRecoveryOptions,
  OperationalRecoveryOptionsSchema,
  runOperationalRecovery,
  type OperationalRecoveryOptions,
  type OperationalRecoveryResult,
} from "../../services/operations/runOperationalRecovery";
import {
  OperationalIssueReportResultSchema,
  ReportIssueRequestSchema,
} from "../../../shared/contracts/operationalAlerts";
import { apiError, apiValidationError, requireServerActor } from "../http/apiResponses";

export function createOperationalRecoveryHandler({
  run = runOperationalRecovery,
  secret = process.env.OPERATIONS_SCHEDULER_SECRET,
  configuredOptions = configuredOperationalRecoveryOptions,
}: {
  run?: (options?: OperationalRecoveryOptions) => Promise<OperationalRecoveryResult>;
  secret?: string;
  configuredOptions?: () => OperationalRecoveryOptions;
} = {}) {
  return async function postOperationalRecovery(request: Request) {
    const authentication = authenticateScheduler(request, secret);
    if (authentication) return authentication;

    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return apiError(400, "invalid_json", "Operational recovery request must contain valid JSON.");
    }
    const parsed = OperationalRecoveryOptionsSchema.partial().safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error, "Operational recovery request is invalid.");
    }

    try {
      return Response.json(await run({ ...configuredOptions(), ...parsed.data }));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return apiError(503, "recovery_configuration_invalid", "Operational recovery configuration is invalid.");
      }
      return apiError(503, "operational_recovery_failed", "Operational recovery could not be completed.");
    }
  };
}

export function createReportOperationalIssueHandler({
  report = reportOperationalIssue,
  actorResolver = resolveServerActor,
}: {
  report?: typeof reportOperationalIssue;
  actorResolver?: ServerActorResolver;
} = {}) {
  return async function postReportOperationalIssue(request: Request) {
    const auth = await requireServerActor(request, "read", actorResolver);
    if ("response" in auth) return auth.response;

    let body: unknown;
    try {
      body = JSON.parse(await request.text());
    } catch {
      return apiError(400, "invalid_json", "Issue report must contain valid JSON.");
    }
    const parsed = ReportIssueRequestSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error, "Issue report is invalid.");

    try {
      const result = OperationalIssueReportResultSchema.parse(await report({
        meetingId: parsed.data.meetingId,
        reporterProfileId: auth.actor.profileId,
        comment: parsed.data.comment ?? null,
      }));
      if (result.status === "not_found") {
        return apiError(404, "meeting_not_found", "Meeting was not found.");
      }
      if (result.status === "invalid_actor") {
        return apiError(403, "invalid_actor", "Your profile cannot report an issue.");
      }
      return Response.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return apiError(503, "invalid_issue_report_result", "Issue reporting returned an invalid result.");
      }
      return apiError(503, "issue_reporting_unavailable", "Issue reporting is unavailable.");
    }
  };
}

function authenticateScheduler(request: Request, secret: string | undefined) {
  if (!secret?.trim()) {
    return apiError(503, "scheduler_auth_not_configured", "Scheduler authentication is not configured.");
  }
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return apiError(401, "invalid_authorization", "A valid scheduler bearer token is required.");
  }
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret.trim(), "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return apiError(401, "invalid_authorization", "A valid scheduler bearer token is required.");
  }
  return null;
}

export const handleOperationalRecovery = createOperationalRecoveryHandler();
export const handleReportOperationalIssue = createReportOperationalIssueHandler();
