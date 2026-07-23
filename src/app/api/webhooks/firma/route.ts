import { after } from "next/server";
import { createFirmaWebhookHandler } from "../../../../backend/integrations/webhooks/firmaWebhookHandler";

export const runtime = "nodejs";

export const POST = createFirmaWebhookHandler({
  schedule: (work) => after(work),
});
