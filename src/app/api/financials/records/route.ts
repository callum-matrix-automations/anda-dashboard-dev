import { createFinancialRecordListHandler, createFinancialRecordUploadHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const GET = createFinancialRecordListHandler();
export const POST = createFinancialRecordUploadHandler();
