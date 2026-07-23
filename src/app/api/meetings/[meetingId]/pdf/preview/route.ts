import { createMeetingPdfPreviewHandler } from "@/backend/integrations/meetings/meetingPdfPreviewHandler";

export const runtime = "nodejs";
export const GET = createMeetingPdfPreviewHandler();
