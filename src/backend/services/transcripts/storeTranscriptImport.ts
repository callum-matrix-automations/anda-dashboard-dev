import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import type { TranscriptWebhookPacket } from "../../../shared/contracts/transcriptWebhook";

export function createTranscriptImportStore(repository: TranscriptRepository) {
  return async function storeTranscriptImport(packet: TranscriptWebhookPacket) {
    return repository.storeImport({
      sourceMeetingId: packet.meeting.sourceMeetingId,
      title: packet.meeting.title,
      meetingDate: packet.meeting.startedAt.slice(0, 10),
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      content: packet.transcript.content,
    });
  };
}

export const storeTranscriptImport = createTranscriptImportStore(supabaseTranscriptRepository);
