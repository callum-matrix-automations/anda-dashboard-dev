import { createPropertyCreateHandler, createPropertyListHandler } from "@/backend/integrations/properties/propertyApiHandlers";

export const runtime = "nodejs";
export const GET = createPropertyListHandler();
export const POST = createPropertyCreateHandler();
