import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import type { TranscriptWebhookPacket } from "../../../shared/contracts/transcriptWebhook";
import {
  resolveTranscriptAttendees,
} from "./matchTranscriptAttendees";

export function createTranscriptImportStore(repository: TranscriptRepository) {
  return async function storeTranscriptImport(packet: TranscriptWebhookPacket) {
    const profiles = await repository.listActiveMemberProfiles();
    const attendees = resolveTranscriptAttendees(packet.attendees, profiles, {
      matchByName: packet.transcript.metadata?.provider === "manual_upload",
    });

    const stored = await repository.storeImport({
      sourceMeetingId: packet.meeting.sourceMeetingId,
      title: packet.meeting.title,
      meetingDate: packet.meeting.startedAt.slice(0, 10),
      durationMinutes: packet.meeting.durationMinutes,
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      content: packet.transcript.content,
      metadata: packet.transcript.metadata ?? {},
      attendees,
    });
    return stored;
  };
}

export const storeTranscriptImport = createTranscriptImportStore(supabaseTranscriptRepository);
