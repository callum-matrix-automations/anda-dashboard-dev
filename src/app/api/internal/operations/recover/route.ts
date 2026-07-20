import { handleOperationalRecovery } from "@/backend/integrations/operations/operationalHandlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handleOperationalRecovery;
