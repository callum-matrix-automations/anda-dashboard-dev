import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import type { TranscriptWebhookPacket } from "../../../shared/contracts/transcriptWebhook";
import { matchTranscriptAttendees } from "./matchTranscriptAttendees";

export function createTranscriptImportStore(repository: TranscriptRepository) {
  return async function storeTranscriptImport(packet: TranscriptWebhookPacket) {
    const profiles = await repository.listActiveMemberProfiles();
    const attendeeMatches = matchTranscriptAttendees(packet.attendees, profiles);

    return repository.storeImport({
      sourceMeetingId: packet.meeting.sourceMeetingId,
      title: packet.meeting.title,
      meetingDate: packet.meeting.startedAt.slice(0, 10),
      durationMinutes: packet.meeting.durationMinutes,
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      content: packet.transcript.content,
      attendees: attendeeMatches.matched,
    });
  };
}

export const storeTranscriptImport = createTranscriptImportStore(supabaseTranscriptRepository);
