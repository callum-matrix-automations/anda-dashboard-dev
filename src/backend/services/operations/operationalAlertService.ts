import type {
  OperationalAlertRepository,
  ResolveOperationalAlertInput,
} from "../../repositories/operations/operationalAlertRepository";
import { supabaseOperationalAlertRepository } from "../../repositories/supabase/supabaseOperationalAlertRepository";
import {
  OperationalAlertInputSchema,
  type OperationalAlertInput,
} from "../../../shared/contracts/operationalAlerts";

export interface OperationalAlertService {
  recordFailure(input: OperationalAlertInput): Promise<unknown>;
  resolveFailure(input: ResolveOperationalAlertInput): Promise<number>;
}

export function createOperationalAlertService(
  repository: OperationalAlertRepository = supabaseOperationalAlertRepository,
): OperationalAlertService {
  return {
    recordFailure(input) {
      return repository.record(OperationalAlertInputSchema.parse(input));
    },
    resolveFailure(input) {
      return repository.resolve(input);
    },
  };
}

export async function safelyRecordOperationalFailure(
  alerts: OperationalAlertService | undefined,
  input: OperationalAlertInput,
  logger: Pick<Console, "error"> = console,
) {
  if (!alerts) return;
  try {
    await alerts.recordFailure(input);
  } catch (error) {
    logger.error("Operational alert could not be recorded", safeLogContext(input, error));
  }
}

export async function safelyResolveOperationalFailure(
  alerts: OperationalAlertService | undefined,
  input: ResolveOperationalAlertInput,
  logger: Pick<Console, "error"> = console,
) {
  if (!alerts) return;
  try {
    await alerts.resolveFailure(input);
  } catch (error) {
    logger.error("Operational alert could not be resolved", {
      stage: input.stage,
      meetingId: input.meetingId ?? null,
      entityRef: input.entityRef ?? null,
      reason: safeErrorCode(error),
    });
  }
}

function safeLogContext(input: OperationalAlertInput, error: unknown) {
  return {
    stage: input.stage,
    meetingId: input.meetingId ?? null,
    entityRef: input.entityRef ?? null,
    failureCode: input.failureCode,
    reason: safeErrorCode(error),
  };
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 200);
  }
  return "operational_alert_persistence_failed";
}

export const operationalAlertService = createOperationalAlertService();
