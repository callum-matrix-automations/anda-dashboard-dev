import type { TranscriptWebhookPacket } from "../../../shared/contracts/transcriptWebhook";
import type {
  ReadAiMeetingEndWebhook,
  ReadAiPerson,
  ReadAiWebhookPayload,
} from "../../../shared/contracts/readAiWebhook";
import { normalizeProfileEmail } from "../../../shared/schemas/profileEmail";

export class ReadAiTranscriptAdapterError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_meeting_time" | "invalid_speaker_time" | "empty_transcript",
  ) {
    super(message);
    this.name = "ReadAiTranscriptAdapterError";
  }
}

export type ReadAiTranscriptAdapterResult =
  | { status: "ignored"; eventId: string; reason: "meeting_start" }
  | { status: "ready"; packet: TranscriptWebhookPacket };

export function adaptReadAiWebhook(
  payload: ReadAiWebhookPayload,
  { receivedAt = () => new Date() }: { receivedAt?: () => Date } = {},
): ReadAiTranscriptAdapterResult {
  if (payload.trigger === "meeting_start") {
    return { status: "ignored", eventId: payload.request_id, reason: "meeting_start" };
  }

  return {
    status: "ready",
    packet: adaptMeetingEnd(payload, receivedAt()),
  };
}

function adaptMeetingEnd(payload: ReadAiMeetingEndWebhook, receivedAt: Date): TranscriptWebhookPacket {
  const startedAt = new Date(payload.start_time);
  const endedAt = new Date(payload.end_time);
  const durationMs = endedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new ReadAiTranscriptAdapterError(
      "Read AI meeting end_time must be later than start_time.",
      "invalid_meeting_time",
    );
  }

  const durationMinutes = Math.ceil(durationMs / 60_000);
  if (durationMinutes > 1_440) {
    throw new ReadAiTranscriptAdapterError(
      "Read AI meeting duration exceeds the supported 24-hour limit.",
      "invalid_meeting_time",
    );
  }

  const speakerBlocks = payload.transcript.speaker_blocks
    .map((block, sourceIndex) => {
      const startTime = numericTimestamp(block.start_time);
      const endTime = numericTimestamp(block.end_time);
      if (endTime < startTime) {
        throw new ReadAiTranscriptAdapterError(
          `Read AI speaker block ${sourceIndex} ends before it starts.`,
          "invalid_speaker_time",
        );
      }
      return { ...block, sourceIndex, startTime, endTime };
    })
    .filter((block) => block.words.trim().length > 0)
    .sort((left, right) => left.startTime - right.startTime || left.sourceIndex - right.sourceIndex);

  const content = speakerBlocks
    .map((block) => `${block.speaker.name.trim()}: ${block.words.trim()}`)
    .join("\n");
  if (!content) {
    throw new ReadAiTranscriptAdapterError(
      "Read AI meeting_end payload does not contain any transcript text.",
      "empty_transcript",
    );
  }

  const sourceId = `read_ai:${payload.session_id}`;
  return {
    eventId: payload.request_id,
    eventType: "transcript.ready",
    occurredAt: endedAt.toISOString(),
    sentAt: receivedAt.toISOString(),
    meeting: {
      sourceMeetingId: sourceId,
      title: payload.title.trim(),
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMinutes,
    },
    attendees: deduplicateParticipants(payload.participants),
    transcript: {
      sourceTranscriptId: sourceId,
      contentType: "text/plain",
      language: "und",
      content,
      metadata: {
        provider: "read_ai",
        sessionId: payload.session_id,
        requestId: payload.request_id,
        platform: payload.platform,
        platformMeetingId: payload.platform_meeting_id,
        reportUrl: payload.report_url,
        startTime: payload.start_time,
        endTime: payload.end_time,
        owner: payload.owner,
        participants: payload.participants,
        summary: payload.summary,
        actionItems: payload.action_items,
        keyQuestions: payload.key_questions,
        topics: payload.topics,
        chapterSummaries: payload.chapter_summaries,
        transcript: payload.transcript,
      },
    },
  };
}

function numericTimestamp(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ReadAiTranscriptAdapterError(
      "Read AI speaker timestamps must be non-negative millisecond integers.",
      "invalid_speaker_time",
    );
  }
  return parsed;
}

function deduplicateParticipants(participants: ReadAiPerson[]) {
  const seen = new Set<string>();
  return participants.flatMap((participant) => {
    const displayName = participant.name.trim().replace(/\s+/gu, " ");
    const sourceEmail = participant.email?.trim() || null;
    const normalizedEmail = normalizeProfileEmail(sourceEmail);
    const key = normalizedEmail
      ? `email:${normalizedEmail}`
      : `name:${displayName.toLocaleLowerCase("en-GB")}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ displayName, email: normalizedEmail ?? sourceEmail }];
  });
}
