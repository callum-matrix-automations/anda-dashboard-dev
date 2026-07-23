import { createInternalMeetingAnalysisHandler } from "@/backend/integrations/internal/meetingAnalysisHandler";

export const runtime = "nodejs";
export const POST = createInternalMeetingAnalysisHandler();
