import { z } from "zod";
import type { OperationalAlertRepository } from "../../repositories/operations/operationalAlertRepository";
import { supabaseOperationalAlertRepository } from "../../repositories/supabase/supabaseOperationalAlertRepository";
import {
  signingOutcomeProcessor,
  type SigningOutcomeProcessResult,
} from "../signing/processSigningOutcome";
import type { MeetingSigningOutcomeClaim } from "../../../shared/contracts/meetingSigning";
import {
  operationalAlertService,
  safelyRecordOperationalFailure,
  safelyResolveOperationalFailure,
  type OperationalAlertService,
} from "./operationalAlertService";

export interface SigningReconciliationBatchResult {
  processed: number;
  recovered: number;
  pending: number;
  failed: number;
  skipped: number;
  results: SigningOutcomeProcessResult[];
}

export function createStaleSigningReconciliation({
  repository = supabaseOperationalAlertRepository,
  processClaim = signingOutcomeProcessor.processClaim,
  alerts = operationalAlertService,
}: {
  repository?: OperationalAlertRepository;
  processClaim?: (
    claim: Extract<MeetingSigningOutcomeClaim, { status: "claimed" }>,
  ) => Promise<SigningOutcomeProcessResult>;
  alerts?: OperationalAlertService;
} = {}) {
  return async function reconcileStaleMeetingSignings({
    ageMinutes = 10,
    limit = 25,
    maxAttempts = 5,
  }: {
    ageMinutes?: number;
    limit?: number;
    maxAttempts?: number;
  } = {}): Promise<SigningReconciliationBatchResult> {
    const validatedAge = z.number().int().min(1).max(10_080).parse(ageMinutes);
    const validatedLimit = z.number().int().min(1).max(100).parse(limit);
    const validatedMaxAttempts = z.number().int().min(1).max(20).parse(maxAttempts);
    const claims = await repository.claimStaleSigningCandidates(
      validatedAge,
      validatedLimit,
      validatedMaxAttempts,
    );
    const batch: SigningReconciliationBatchResult = {
      processed: 0,
      recovered: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };

    for (const claim of claims) {
      const meetingId = claim.meetingId;
      const result = await processClaim(claim);
      batch.results.push(result);
      batch.processed += 1;
      if (result.status === "ready_for_archive") {
        batch.recovered += 1;
        await safelyResolveOperationalFailure(alerts, { stage: "SIGNING", meetingId });
      } else if (result.status === "no_change") {
        batch.pending += 1;
      } else if (result.status === "failed") {
        batch.failed += 1;
        if (!result.retryable || result.attempt >= validatedMaxAttempts) {
          await safelyRecordOperationalFailure(alerts, {
            stage: "SIGNING",
            meetingId,
            failureCode: result.error.code,
            workflowStatus: "ESIGN_FAILED",
          });
        }
      } else {
        batch.skipped += 1;
      }
    }
    return batch;
  };
}

export const reconcileStaleMeetingSignings = createStaleSigningReconciliation();
