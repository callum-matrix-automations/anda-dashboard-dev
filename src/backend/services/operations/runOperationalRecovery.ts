import { z } from "zod";
import { recoverMeetingArchives } from "../archive/recoverMeetingArchives";
import type { MeetingArchiveProcessResult } from "../archive/processMeetingArchive";
import { dispatchOperationalAlerts, type OperationalAlertDispatchResult } from "./dispatchOperationalAlerts";
import {
  reconcileStaleMeetingSignings,
  type SigningReconciliationBatchResult,
} from "./reconcileStaleMeetingSignings";

export interface OperationalRecoveryOptions {
  signingAgeMinutes?: number;
  signingLimit?: number;
  signingMaxAttempts?: number;
  archiveLimit?: number;
  archiveMaxAttempts?: number;
  alertLimit?: number;
  alertMaxAttempts?: number;
  alertRetryDelaySeconds?: number;
}

export interface OperationalRecoveryResult {
  signing: SigningReconciliationBatchResult;
  archive: { processed: number; results: MeetingArchiveProcessResult[] };
  alerts: OperationalAlertDispatchResult;
}

export function createOperationalRecoveryRunner({
  reconcileSigning = reconcileStaleMeetingSignings,
  recoverArchive = recoverMeetingArchives,
  dispatchAlerts = dispatchOperationalAlerts,
}: {
  reconcileSigning?: typeof reconcileStaleMeetingSignings;
  recoverArchive?: typeof recoverMeetingArchives;
  dispatchAlerts?: typeof dispatchOperationalAlerts;
} = {}) {
  return async function runOperationalRecovery(
    options: OperationalRecoveryOptions = {},
  ): Promise<OperationalRecoveryResult> {
    const config = OperationalRecoveryOptionsSchema.parse(options);
    const signing = await reconcileSigning({
      ageMinutes: config.signingAgeMinutes,
      limit: config.signingLimit,
      maxAttempts: config.signingMaxAttempts,
    });
    const archive = await recoverArchive(config.archiveLimit, config.archiveMaxAttempts);
    const alerts = await dispatchAlerts({
      limit: config.alertLimit,
      maxAttempts: config.alertMaxAttempts,
      retryDelaySeconds: config.alertRetryDelaySeconds,
    });
    return { signing, archive, alerts };
  };
}

export const OperationalRecoveryOptionsSchema = z.object({
  signingAgeMinutes: z.number().int().min(1).max(10_080).default(10),
  signingLimit: z.number().int().min(1).max(100).default(25),
  signingMaxAttempts: z.number().int().min(1).max(20).default(5),
  archiveLimit: z.number().int().min(1).max(100).default(25),
  archiveMaxAttempts: z.number().int().min(1).max(20).default(3),
  alertLimit: z.number().int().min(1).max(100).default(25),
  alertMaxAttempts: z.number().int().min(1).max(10).default(3),
  alertRetryDelaySeconds: z.number().int().min(1).max(86_400).default(30),
}).strict();

export function configuredOperationalRecoveryOptions(): OperationalRecoveryOptions {
  return OperationalRecoveryOptionsSchema.parse({
    signingAgeMinutes: environmentInteger("OPERATIONS_SIGNING_STALE_MINUTES", 10),
    signingLimit: environmentInteger("OPERATIONS_SIGNING_BATCH_LIMIT", 25),
    signingMaxAttempts: environmentInteger("OPERATIONS_SIGNING_MAX_ATTEMPTS", 5),
    archiveLimit: environmentInteger("OPERATIONS_ARCHIVE_BATCH_LIMIT", 25),
    archiveMaxAttempts: environmentInteger("OPERATIONS_ARCHIVE_MAX_ATTEMPTS", 3),
    alertLimit: environmentInteger("OPERATIONS_ALERT_BATCH_LIMIT", 25),
    alertMaxAttempts: environmentInteger("OPERATIONS_ALERT_MAX_ATTEMPTS", 3),
    alertRetryDelaySeconds: environmentInteger("OPERATIONS_ALERT_RETRY_DELAY_SECONDS", 30),
  });
}

function environmentInteger(name: string, fallback: number) {
  const value = process.env[name];
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

export const runOperationalRecovery = createOperationalRecoveryRunner();
