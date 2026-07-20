import { createMeetingSearchHandler } from "@/backend/integrations/meetings/meetingApiHandlers";

export const runtime = "nodejs";
export const GET = createMeetingSearchHandler();
