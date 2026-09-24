import type { TranscriptRepository } from "../../repositories/transcripts/transcriptRepository";
import { supabaseTranscriptRepository } from "../../repositories/supabase/supabaseTranscriptRepository";
import type { TranscriptWebhookPacket } from "../../../shared/contracts/transcriptWebhook";
import {
  resolveTranscriptAttendees,
} from "./matchTranscriptAttendees";
import { TranscriptParticipantSchema } from "../../../shared/contracts/transcriptNormalization";

export function createTranscriptImportStore(repository: TranscriptRepository) {
  return async function storeTranscriptImport(packet: TranscriptWebhookPacket) {
    const profiles = await repository.listActiveMemberProfiles();
    const genericSpeakerNames = genericSpeakers(packet.transcript.metadata);
    const attendees = resolveTranscriptAttendees(packet.attendees, profiles, {
      matchByName: packet.transcript.metadata?.provider === "manual_upload",
    }).map((attendee) => genericSpeakerNames.has(normalizeName(attendee.displayNameSnapshot))
      ? { ...attendee, profileId: null }
      : attendee);

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

function genericSpeakers(metadata: Record<string, unknown> | undefined) {
  const normalization = metadata?.normalization;
  if (!normalization || typeof normalization !== "object" || Array.isArray(normalization)) {
    return new Set<string>();
  }
  const participants = TranscriptParticipantSchema.array().safeParse(
    (normalization as Record<string, unknown>).participants,
  );
  if (!participants.success) return new Set<string>();
  return new Set(participants.data
    .filter((participant) => participant.kind === "generic")
    .map((participant) => normalizeName(participant.displayName)));
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");
}

export const storeTranscriptImport = createTranscriptImportStore(supabaseTranscriptRepository);
