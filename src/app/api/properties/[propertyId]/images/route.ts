import { createPropertyImageUploadHandler } from "@/backend/integrations/properties/propertyApiHandlers";

export const runtime = "nodejs";
export const POST = createPropertyImageUploadHandler();
