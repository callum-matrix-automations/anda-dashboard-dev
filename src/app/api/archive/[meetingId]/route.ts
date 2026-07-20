import { createArchiveDetailHandler } from "@/backend/integrations/archive/meetingArchiveHandlers";

export const runtime = "nodejs";
export const GET = createArchiveDetailHandler();
