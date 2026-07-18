import { handleTranscriptWebhook } from "../../../../backend/integrations/webhooks/transcriptWebhookHandler";

export const runtime = "nodejs";
export const POST = handleTranscriptWebhook;
