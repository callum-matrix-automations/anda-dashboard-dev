import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";

export function createUnmatchedTranscriptParticipantResolver(repository: TranscriptRepository) {
  return async function resolveUnmatchedTranscriptParticipants(meetingId: string) {
    return {
      meetingId,
      resolvedCount: await repository.resolveUnmatchedParticipants(meetingId),
    };
  };
}

export const resolveUnmatchedTranscriptParticipants = createUnmatchedTranscriptParticipantResolver(
  supabaseTranscriptRepository,
);
