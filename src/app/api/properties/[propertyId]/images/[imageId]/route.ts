import { createPropertyImageContentHandler, createPropertyImageDeleteHandler } from "@/backend/integrations/properties/propertyApiHandlers";

export const runtime = "nodejs";
export const GET = createPropertyImageContentHandler();
export const DELETE = createPropertyImageDeleteHandler();
