import { createArchiveRecoveryHandler } from "@/backend/integrations/archive/meetingArchiveHandlers";

export const runtime = "nodejs";
export const POST = createArchiveRecoveryHandler();
