import { createFinancialRecordContentHandler } from "@/backend/integrations/financials/financialApiHandlers";

export const runtime = "nodejs";
export const GET = createFinancialRecordContentHandler();
