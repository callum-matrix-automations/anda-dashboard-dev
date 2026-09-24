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
import {
  normalizeTranscript,
} from "./normalizeTranscript";
import type { TranscriptNormalizationResult } from "../../../shared/contracts/transcriptNormalization";
import { normalizeKnownTranscript } from "../../../shared/transcripts/normalizeKnownTranscript";

export class ManualTranscriptUploadError extends Error {
  constructor(
    message: string,
    readonly code: "duplicate_upload" | "analysis_unavailable" | "normalization_failed",
    readonly meetingId?: string,
  ) {
    super(message);
    this.name = "ManualTranscriptUploadError";
  }
}

export function createManualTranscriptUploadProcessor({
  store = storeTranscriptImport,
  analyze = processMeetingAnalysis,
  normalize = normalizeTranscript,
  now = () => new Date(),
  createId = randomUUID,
}: {
  store?: (packet: TranscriptWebhookPacket) => Promise<StoredTranscriptImport>;
  analyze?: (meetingId: string) => Promise<MeetingAnalysisProcessResult>;
  normalize?: (content: string) => Promise<TranscriptNormalizationResult>;
  now?: () => Date;
  createId?: () => string;
} = {}) {
  return async function processManualTranscriptUpload(
    input: ManualTranscriptUploadRequest,
    actor: ServerActor,
  ): Promise<ManualTranscriptUploadResponse> {
    const upload = ManualTranscriptUploadRequestSchema.parse(input);
    let normalization: TranscriptNormalizationResult;
    try {
      normalization = await normalize(upload.transcript);
    } catch (error) {
      throw new ManualTranscriptUploadError(
        error instanceof Error ? error.message : "The transcript format could not be normalized safely.",
        "normalization_failed",
      );
    }
    const packet = manualUploadPacket(upload, actor, normalization, now(), createId());
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
        normalization: normalizationSummary(normalization),
      };
    }
    if (result.status === "failed") {
      return {
        status: "ai_failed",
        meetingId: result.meetingId,
        analysisAttempts: result.attempts,
        error: result.error,
        normalization: normalizationSummary(normalization),
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
  return normalizeKnownTranscript(content).summary?.participants.map((participant) => participant.displayName) ?? [];
}

function manualUploadPacket(
  upload: ManualTranscriptUploadRequest,
  actor: ServerActor,
  normalization: TranscriptNormalizationResult,
  receivedAt: Date,
  identifier: string,
) {
  const startedAt = new Date(`${upload.meetingDate}T09:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + upload.durationMinutes * 60_000);
  const sourceId = `manual:${identifier}`;
  const participants = normalization.participants
    .map((participant) => ({ name: participant.displayName, email: null, kind: participant.kind }));

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
        normalization: {
          ...normalizationSummary(normalization),
          normalizedContent: normalization.canonicalTranscript,
          originalContentHash: normalization.originalContentHash,
          normalizedContentHash: normalization.normalizedContentHash,
          model: normalization.model,
          responseId: normalization.responseId,
          requestId: normalization.requestId,
        },
        uploadedBy: {
          profileId: actor.profileId,
          displayName: actor.displayName,
        },
      },
    },
  });
}

function normalizationSummary(normalization: TranscriptNormalizationResult) {
  return {
    method: normalization.method,
    detectedFormat: normalization.detectedFormat,
    participants: normalization.participants,
    possibleAliases: normalization.possibleAliases,
    warnings: normalization.warnings,
    turnCount: normalization.turnCount,
    attributionCoverage: normalization.attributionCoverage,
  };
}

export const processManualTranscriptUpload = createManualTranscriptUploadProcessor();
