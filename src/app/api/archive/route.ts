import { createArchiveListHandler } from "@/backend/integrations/archive/meetingArchiveHandlers";

export const runtime = "nodejs";
export const GET = createArchiveListHandler();
