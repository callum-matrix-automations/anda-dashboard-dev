import type { ServerActor, ServerActorResolver } from "../../auth/serverActor";
import { resolveServerActor } from "../../auth/serverActor";
import {
  ManualTranscriptUploadError,
  processManualTranscriptUpload,
} from "../../services/transcripts/processManualTranscriptUpload";
import {
  ManualTranscriptUploadRequestSchema,
  ManualTranscriptUploadResponseSchema,
  type ManualTranscriptUploadRequest,
  type ManualTranscriptUploadResponse,
} from "../../../shared/contracts/manualTranscriptUpload";
import { apiError, apiValidationError, requireServerActor } from "../http/apiResponses";

interface ManualTranscriptUploadHandlerOptions {
  actorResolver?: ServerActorResolver;
  processUpload?: (
    input: ManualTranscriptUploadRequest,
    actor: ServerActor,
  ) => Promise<ManualTranscriptUploadResponse>;
}

export function createManualTranscriptUploadHandler({
  actorResolver = resolveServerActor,
  processUpload = processManualTranscriptUpload,
}: ManualTranscriptUploadHandlerOptions = {}) {
  return async function handleManualTranscriptUpload(request: Request) {
    const auth = await requireServerActor(request, "review", actorResolver);
    if ("response" in auth) return auth.response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError(400, "invalid_json", "Request body must contain valid JSON.");
    }
    const parsed = ManualTranscriptUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      return apiValidationError(parsed.error, "Transcript upload details are invalid.");
    }

    try {
      const result = await processUpload(parsed.data, auth.actor);
      return Response.json(ManualTranscriptUploadResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof ManualTranscriptUploadError) {
        return apiError(
          error.code === "duplicate_upload" ? 409 : 503,
          error.code,
          error.message,
        );
      }
      return apiError(
        503,
        "transcript_processing_unavailable",
        "The transcript could not be processed.",
      );
    }
  };
}

export const handleManualTranscriptUpload = createManualTranscriptUploadHandler();
