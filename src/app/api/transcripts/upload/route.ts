import { handleManualTranscriptUpload } from "@/backend/integrations/transcripts/manualTranscriptUploadHandler";

export const runtime = "nodejs";
export const maxDuration = 300;
export const POST = handleManualTranscriptUpload;
