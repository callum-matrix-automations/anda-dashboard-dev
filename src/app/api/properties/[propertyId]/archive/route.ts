import { createPropertyArchiveHandler } from "@/backend/integrations/properties/propertyApiHandlers";

export const runtime = "nodejs";
export const POST = createPropertyArchiveHandler(true);
