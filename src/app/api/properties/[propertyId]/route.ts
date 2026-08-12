import { createPropertyDetailHandler, createPropertyUpdateHandler } from "@/backend/integrations/properties/propertyApiHandlers";

export const runtime = "nodejs";
export const GET = createPropertyDetailHandler();
export const PATCH = createPropertyUpdateHandler();
