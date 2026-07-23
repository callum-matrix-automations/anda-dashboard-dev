import { z } from "zod";
import type { ServerActorResolver } from "../../auth/serverActor";
import {
  getMeetingPdfPreview,
  type MeetingPdfPreviewResult,
} from "../../services/pdf/getMeetingPdfPreview";
import { apiError, requireServerActor } from "../http/apiResponses";

type RouteContext = { params: Promise<{ meetingId: string }> };

interface MeetingPdfPreviewHandlerOptions {
  previewService?: (meetingId: string) => Promise<MeetingPdfPreviewResult>;
  actorResolver?: ServerActorResolver;
}

export function createMeetingPdfPreviewHandler({
  previewService = getMeetingPdfPreview,
  actorResolver,
}: MeetingPdfPreviewHandlerOptions = {}) {
  return async function meetingPdfPreview(request: Request, context: RouteContext) {
    const auth = await requireServerActor(request, "review", actorResolver);
    if ("response" in auth) return auth.response;

    const parsedMeetingId = z.string().uuid().safeParse((await context.params).meetingId);
    if (!parsedMeetingId.success) {
      return apiError(400, "invalid_meeting_id", "Meeting ID must be a UUID.");
    }

    try {
      const result = await previewService(parsedMeetingId.data);
      if (result.status === "not_found") {
        return apiError(404, "meeting_not_found", "Meeting was not found.");
      }
      if (result.status === "not_ready") {
        return apiError(409, "pdf_preview_not_ready", "The approved PDF is not ready to preview.");
      }

      return new Response(Buffer.from(result.bytes), {
        status: 200,
        headers: {
          "cache-control": "private, no-store, max-age=0",
          "content-disposition": `inline; filename="anda-meeting-minutes-v${result.documentVersion}.pdf"`,
          "content-length": String(result.bytes.byteLength),
          "content-type": "application/pdf",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return apiError(503, "pdf_preview_unavailable", "The approved PDF preview is temporarily unavailable.");
    }
  };
}
