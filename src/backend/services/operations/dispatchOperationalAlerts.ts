import { z } from "zod";
import type { OperationalAlertProvider } from "../../integrations/alerts/operationalAlertProvider";
import {
  TelegramOperationalAlertError,
  telegramOperationalAlertProvider,
} from "../../integrations/alerts/telegramOperationalAlertProvider";
import type { OperationalAlertRepository } from "../../repositories/operations/operationalAlertRepository";
import { supabaseOperationalAlertRepository } from "../../repositories/supabase/supabaseOperationalAlertRepository";

export interface OperationalAlertDispatchResult {
  status: "completed" | "not_configured";
  processed: number;
  delivered: number;
  retryScheduled: number;
  exhausted: number;
  stale: number;
}

export function createOperationalAlertDispatcher({
  repository = supabaseOperationalAlertRepository,
  provider = telegramOperationalAlertProvider,
}: {
  repository?: OperationalAlertRepository;
  provider?: OperationalAlertProvider;
} = {}) {
  return async function dispatchOperationalAlerts({
    limit = 25,
    maxAttempts = 3,
    retryDelaySeconds = 30,
  }: {
    limit?: number;
    maxAttempts?: number;
    retryDelaySeconds?: number;
  } = {}): Promise<OperationalAlertDispatchResult> {
    const validatedLimit = z.number().int().min(1).max(100).parse(limit);
    const validatedMaxAttempts = z.number().int().min(1).max(10).parse(maxAttempts);
    const validatedRetryDelay = z.number().int().min(1).max(86_400).parse(retryDelaySeconds);
    if (!provider.isConfigured()) return emptyResult("not_configured");

    const claims = await repository.claimDeliveries(validatedLimit, validatedMaxAttempts);
    const result = emptyResult("completed");
    result.processed = claims.length;
    for (const claim of claims) {
      try {
        await provider.send(claim);
        const completion = await repository.completeDelivery(claim.alertId, claim.runId);
        if (completion === "saved") result.delivered += 1;
        else result.stale += 1;
      } catch (error) {
        const failure = await repository.recordDeliveryFailure(
          claim.alertId,
          claim.runId,
          safeDeliveryErrorCode(error),
          validatedRetryDelay,
          validatedMaxAttempts,
        );
        if (failure === "retry_scheduled") result.retryScheduled += 1;
        else if (failure === "exhausted") result.exhausted += 1;
        else result.stale += 1;
      }
    }
    return result;
  };
}

function emptyResult(status: OperationalAlertDispatchResult["status"]): OperationalAlertDispatchResult {
  return { status, processed: 0, delivered: 0, retryScheduled: 0, exhausted: 0, stale: 0 };
}

function safeDeliveryErrorCode(error: unknown) {
  if (error instanceof TelegramOperationalAlertError) return error.code;
  return "alert_delivery_failed";
}

export const dispatchOperationalAlerts = createOperationalAlertDispatcher();
