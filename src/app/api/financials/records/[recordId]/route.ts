import { createFinancialRecordDetailHandler, createFinancialRecordUpdateHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const GET = createFinancialRecordDetailHandler();
export const PATCH = createFinancialRecordUpdateHandler();
