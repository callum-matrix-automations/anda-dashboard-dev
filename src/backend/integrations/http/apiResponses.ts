import { z } from "zod";
import {
  actorHasPermission,
  resolveServerActor,
  type MeetingPermission,
  type ServerActor,
  type ServerActorResolver,
} from "../../auth/serverActor";

export interface ApiErrorDetails {
  issues?: Array<{ path: string; message: string }>;
  currentVersion?: number | null;
  unresolvedVoteCount?: number;
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details: ApiErrorDetails = {},
) {
  return Response.json({
    error: {
      code,
      message,
      ...details,
    },
  }, { status });
}

export function apiValidationError(error: z.ZodError, message = "The request is invalid.") {
  return apiError(400, "invalid_request", message, {
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

export async function requireServerActor(
  request: Request,
  permission: MeetingPermission,
  resolver: ServerActorResolver = resolveServerActor,
): Promise<{ actor: ServerActor } | { response: Response }> {
  let actor: ServerActor | null;
  try {
    actor = await resolver(request);
  } catch {
    return {
      response: apiError(
        503,
        "authentication_unavailable",
        "Meeting API authentication is unavailable.",
      ),
    };
  }

  if (!actor) {
    return {
      response: apiError(401, "authentication_required", "Authentication is required."),
    };
  }
  if (!actorHasPermission(actor, permission)) {
    return {
      response: apiError(403, "insufficient_role", "Your account cannot perform this action."),
    };
  }
  return { actor };
}

export async function requireCurrentServerActor(
  request: Request,
  resolver: ServerActorResolver = resolveServerActor,
): Promise<{ actor: ServerActor } | { response: Response }> {
  try {
    const actor = await resolver(request);
    if (!actor) {
      return { response: apiError(401, "authentication_required", "Authentication is required.") };
    }
    return { actor };
  } catch {
    return {
      response: apiError(
        503,
        "authentication_unavailable",
        "Application authentication is unavailable.",
      ),
    };
  }
}
