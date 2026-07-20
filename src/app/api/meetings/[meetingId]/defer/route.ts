import { createDeferMeetingHandler } from "@/backend/integrations/meetings/meetingApiHandlers";

export const runtime = "nodejs";
export const POST = createDeferMeetingHandler();
