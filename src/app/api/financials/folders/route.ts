import { createFinancialFolderCreateHandler, createFinancialFolderListHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const GET = createFinancialFolderListHandler();
export const POST = createFinancialFolderCreateHandler();
