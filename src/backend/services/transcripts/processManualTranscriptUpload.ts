import { randomUUID } from "node:crypto";
import type { ServerActor } from "../../auth/serverActor";
import type { StoredTranscriptImport } from "../../repositories/transcripts/transcriptRepository";
import {
  ManualTranscriptUploadRequestSchema,
  type ManualTranscriptUploadRequest,
  type ManualTranscriptUploadResponse,
} from "../../../shared/contracts/manualTranscriptUpload";
import {
  TranscriptWebhookPacketSchema,
  type TranscriptWebhookPacket,
} from "../../../shared/contracts/transcriptWebhook";
import {
  processMeetingAnalysis,
  type MeetingAnalysisProcessResult,
} from "../ai/processMeetingAnalysis";
import { storeTranscriptImport } from "./storeTranscriptImport";

export class ManualTranscriptUploadError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate_upload" | "analysis_unavailable",
    readonly meetingId?: string,
  ) {
    super(message);
    this.name = "ManualTranscriptUploadError";
  }
}

export function createManualTranscriptUploadProcessor({
  store = storeTranscriptImport,
  analyze = processMeetingAnalysis,
  now = () => new Date(),
  createId = randomUUID,
}: {
  store?: (packet: TranscriptWebhookPacket) => Promise<StoredTranscriptImport>;
  analyze?: (meetingId: string) => Promise<MeetingAnalysisProcessResult>;
  now?: () => Date;
  createId?: () => string;
} = {}) {
  return async function processManualTranscriptUpload(
    input: ManualTranscriptUploadRequest,
    actor: ServerActor,
  ): Promise<ManualTranscriptUploadResponse> {
    const upload = ManualTranscriptUploadRequestSchema.parse(input);
    const packet = manualUploadPacket(upload, actor, now(), createId());
    const stored = await store(packet);
    if (stored.status === "duplicate") {
      throw new ManualTranscriptUploadError(
        "This manually uploaded transcript has already been imported.",
        "duplicate_upload",
        stored.meetingId,
      );
    }

    const result = await analyze(stored.meetingId);
    if (result.status === "completed") {
      return {
        status: "pending_approval",
        meetingId: result.meetingId,
        analysisAttempt: result.attempt,
      };
    }
    if (result.status === "failed") {
      return {
        status: "ai_failed",
        meetingId: result.meetingId,
        analysisAttempts: result.attempts,
        error: result.error,
      };
    }
    throw new ManualTranscriptUploadError(
      "The meeting was saved, but AI analysis could not be completed.",
      "analysis_unavailable",
      result.meetingId,
    );
  };
}

export function extractTranscriptSpeakers(content: string) {
  const speakers = new Map<string, string>();
  const speakerPattern = /^([\p{L}][\p{L}\p{M}\d .,'’()\-]{0,199}):[ \t]+\S/gmu;
  for (const match of content.matchAll(speakerPattern)) {
    const displayName = match[1]?.trim().replace(/\s+/gu, " ");
    if (!displayName) continue;
    const key = displayName.toLocaleLowerCase("en-GB");
    if (!speakers.has(key)) speakers.set(key, displayName);
  }
  return [...speakers.values()];
}

function manualUploadPacket(
  upload: ManualTranscriptUploadRequest,
  actor: ServerActor,
  receivedAt: Date,
  identifier: string,
) {
  const startedAt = new Date(`${upload.meetingDate}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + upload.durationMinutes * 60_000);
  const sourceId = `manual:${identifier}`;
  const participants = extractTranscriptSpeakers(upload.transcript)
    .map((name) => ({ name, email: null }));

  return TranscriptWebhookPacketSchema.parse({
    eventId: sourceId,
    eventType: "transcript.ready",
    occurredAt: endedAt.toISOString(),
    sentAt: receivedAt.toISOString(),
    meeting: {
      sourceMeetingId: sourceId,
      title: upload.title,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMinutes: upload.durationMinutes,
    },
    attendees: participants.map((participant) => ({
      displayName: participant.name,
      email: participant.email,
    })),
    transcript: {
      sourceTranscriptId: sourceId,
      contentType: "text/plain",
      language: "und",
      content: upload.transcript.trim(),
      metadata: {
        provider: "manual_upload",
        language: "und",
        startTime: startedAt.toISOString(),
        endTime: endedAt.toISOString(),
        participants,
        uploadedBy: {
          profileId: actor.profileId,
          displayName: actor.displayName,
        },
      },
    },
  });
}

export const processManualTranscriptUpload = createManualTranscriptUploadProcessor();
