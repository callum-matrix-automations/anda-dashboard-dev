import type {
  TranscriptImportFailureRecord,
  TranscriptImportFailureRepository,
} from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";

export function createTranscriptImportAlertService(repository: TranscriptImportFailureRepository) {
  return {
    recordFailure(record: TranscriptImportFailureRecord) {
      return repository.recordFailure(record);
    },
    resolveFailure(sourceMeetingId: string, resolvedAt: string) {
      return repository.resolveFailure("read_ai", sourceMeetingId, resolvedAt);
    },
  };
}

export const transcriptImportAlertService = createTranscriptImportAlertService(supabaseTranscriptRepository);
