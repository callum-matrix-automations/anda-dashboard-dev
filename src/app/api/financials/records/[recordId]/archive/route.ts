import { createFinancialRecordArchiveHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const POST = createFinancialRecordArchiveHandler(true);
