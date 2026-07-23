import { createMeetingListHandler } from "@/backend/integrations/meetings/meetingApiHandlers";

export const runtime = "nodejs";
export const GET = createMeetingListHandler();
