import type {
  TranscriptImportFailureRecord,
  TranscriptImportFailureRepository,
} from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import {
  operationalAlertService,
  safelyRecordOperationalFailure,
  safelyResolveOperationalFailure,
  type OperationalAlertService,
} from "../operations/operationalAlertService";

export function createTranscriptImportAlertService(
  repository: TranscriptImportFailureRepository,
  alerts?: OperationalAlertService,
) {
  return {
    async recordFailure(record: TranscriptImportFailureRecord) {
      await repository.recordFailure(record);
      await safelyRecordOperationalFailure(alerts, {
        stage: "TRANSCRIPT_IMPORT",
        entityRef: record.sourceMeetingId,
        failureCode: record.errorCode,
        workflowStatus: "IMPORT_FAILED",
      });
    },
    async resolveFailure(sourceMeetingId: string, resolvedAt: string) {
      await repository.resolveFailure("read_ai", sourceMeetingId, resolvedAt);
      await safelyResolveOperationalFailure(alerts, {
        stage: "TRANSCRIPT_IMPORT",
        entityRef: sourceMeetingId,
        resolvedAt,
      });
    },
  };
}

export const transcriptImportAlertService = createTranscriptImportAlertService(
  supabaseTranscriptRepository,
  operationalAlertService,
);
