import { createFinancialFolderUpdateHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const PATCH = createFinancialFolderUpdateHandler();
