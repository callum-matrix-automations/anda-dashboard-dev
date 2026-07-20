import { createMeetingDetailHandler } from "@/backend/integrations/meetings/meetingApiHandlers";

export const runtime = "nodejs";
export const GET = createMeetingDetailHandler();
