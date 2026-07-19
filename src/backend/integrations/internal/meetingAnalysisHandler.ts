import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  processMeetingAnalysis,
  type MeetingAnalysisProcessResult,
} from "../../services/ai/processMeetingAnalysis";

type MeetingAnalysisProcessor = (
  meetingId: string,
  options: { manualRetry: boolean },
) => Promise<MeetingAnalysisProcessResult>;

interface MeetingAnalysisRouteContext {
  params: Promise<{ meetingId: string }>;
}

interface InternalMeetingAnalysisHandlerOptions {
  processor?: MeetingAnalysisProcessor;
  secret?: string;
}

export function createInternalMeetingAnalysisHandler({
  processor = processMeetingAnalysis,
  secret = process.env.INTERNAL_ANALYSIS_SECRET,
}: InternalMeetingAnalysisHandlerOptions = {}) {
  return async function handleInternalMeetingAnalysis(
    request: Request,
    context: MeetingAnalysisRouteContext,
  ): Promise<Response> {
    if (!secret?.trim()) {
      return Response.json({
        error: "analysis_endpoint_not_configured",
        message: "Internal meeting analysis authentication is not configured.",
      }, { status: 503 });
    }
    if (!validBearerToken(request.headers.get("authorization"), secret)) {
      return Response.json({
        error: "invalid_internal_authentication",
        message: "A valid internal bearer token is required.",
      }, { status: 401 });
    }

    const { meetingId } = await context.params;
    if (!z.string().uuid().safeParse(meetingId).success) {
      return Response.json({
        error: "invalid_meeting_id",
        message: "Meeting identifier must be a UUID.",
      }, { status: 400 });
    }

    const result = await processor(meetingId, { manualRetry: true });
    return Response.json(result, { status: resultStatus(result) });
  };
}

function validBearerToken(authorization: string | null, secret: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function resultStatus(result: MeetingAnalysisProcessResult): number {
  switch (result.status) {
    case "completed": return 200;
    case "not_found": return 404;
    case "failed": return 502;
    default: return 409;
  }
}
