import type {
  TranscriptReceivedResult,
  TranscriptWebhookPacket,
  TranscriptWebhookResult,
} from "@/shared/contracts/transcriptWebhook";
import type { StoredTranscriptImport } from "../../repositories/transcripts/transcriptRepository";
import { scheduleMeetingAnalysis } from "../../integrations/internal/meetingAnalysisScheduler";
import { storeTranscriptImport } from "./storeTranscriptImport";
import { transcriptImportAlertService } from "./transcriptImportAlerts";

export const MAX_RECEIVE_RETRIES = 3;
const DEFAULT_RETRY_DELAYS_MS = [100, 250, 500] as const;

interface ReceiptLogger {
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

interface TranscriptReceiverOptions {
  processTranscript?: (packet: TranscriptWebhookPacket) => Promise<StoredTranscriptImport | void>;
  now?: () => Date;
  logger?: ReceiptLogger;
  delay?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  startAnalysis?: (meetingId: string) => Promise<unknown>;
  recordFailure?: (record: {
    sourceProvider: "read_ai";
    sourceMeetingId: string;
    requestId: string | null;
    title: string | null;
    platformMeetingId: string | null;
    errorCode: string;
    errorMessage: string;
    attempts: number;
    failedAt: string;
  }) => Promise<void>;
  resolveFailure?: (sourceMeetingId: string, resolvedAt: string) => Promise<void>;
}

interface CompletedTranscript {
  receipt: TranscriptReceivedResult;
  sourceFingerprint: string;
}

export function createTranscriptReceiver({
  processTranscript = async () => undefined,
  now = () => new Date(),
  logger = console,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  startAnalysis = async () => undefined,
  recordFailure = async () => undefined,
  resolveFailure = async () => undefined,
}: TranscriptReceiverOptions = {}) {
  const completed = new Map<string, CompletedTranscript>();

  return async function receive(packet: TranscriptWebhookPacket): Promise<TranscriptWebhookResult> {
    const idempotencyKey = packet.transcript.sourceTranscriptId;
    const existing = completed.get(idempotencyKey);
    const sourceFingerprint = createSourceFingerprint(packet);
    if (existing && existing.sourceFingerprint === sourceFingerprint) {
      return {
        status: "duplicate",
        eventId: packet.eventId,
        sourceMeetingId: packet.meeting.sourceMeetingId,
        sourceTranscriptId: packet.transcript.sourceTranscriptId,
        attempts: 0,
        firstReceivedAt: existing.receipt.receivedAt,
      };
    }

    let lastError: unknown;
    const maximumAttempts = MAX_RECEIVE_RETRIES + 1;
    for (let attempts = 1; attempts <= maximumAttempts; attempts += 1) {
      try {
        const processed = await processTranscript(packet);
        if (processed?.status === "duplicate") {
          await safelyResolveFailure(packet.meeting.sourceMeetingId, processed.importedAt);
          return {
            status: "duplicate",
            eventId: packet.eventId,
            sourceMeetingId: packet.meeting.sourceMeetingId,
            sourceTranscriptId: packet.transcript.sourceTranscriptId,
            attempts: 0,
            firstReceivedAt: processed.importedAt,
          };
        }

        if (processed?.status === "stored") {
          await safelyResolveFailure(packet.meeting.sourceMeetingId, processed.importedAt);
          try {
            await startAnalysis(processed.meetingId);
          } catch (error) {
            logger.error("Transcript analysis could not be started", {
              eventId: packet.eventId,
              sourceMeetingId: packet.meeting.sourceMeetingId,
              sourceTranscriptId: packet.transcript.sourceTranscriptId,
              meetingId: processed.meetingId,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const received: TranscriptReceivedResult = {
          status: "received",
          eventId: packet.eventId,
          sourceMeetingId: packet.meeting.sourceMeetingId,
          sourceTranscriptId: packet.transcript.sourceTranscriptId,
          transcriptCharacters: packet.transcript.content.length,
          attempts,
          receivedAt: processed?.importedAt ?? now().toISOString(),
        };
        completed.set(idempotencyKey, {
          receipt: received,
          sourceFingerprint,
        });
        logger.info("Transcript webhook received", logContext(received));
        return received;
      } catch (error) {
        lastError = error;
        if (attempts <= MAX_RECEIVE_RETRIES) {
          await delay(retryDelaysMs[attempts - 1] ?? 0);
        }
      }
    }

    const failed: TranscriptWebhookResult = {
      status: "failed",
      eventId: packet.eventId,
      sourceMeetingId: packet.meeting.sourceMeetingId,
      sourceTranscriptId: packet.transcript.sourceTranscriptId,
      attempts: maximumAttempts,
      failedAt: now().toISOString(),
      error: {
        code: "receive_failed",
        message: "Transcript receipt failed after three retries.",
      },
    };
    logger.error("Transcript webhook failed", {
      ...logContext(failed),
      reason: lastError instanceof Error ? lastError.message : String(lastError),
    });
    try {
      const metadata = packet.transcript.metadata ?? {};
      await recordFailure({
        sourceProvider: "read_ai",
        sourceMeetingId: packet.meeting.sourceMeetingId,
        requestId: typeof metadata.requestId === "string" ? metadata.requestId : packet.eventId,
        title: packet.meeting.title,
        platformMeetingId: typeof metadata.platformMeetingId === "string" ? metadata.platformMeetingId : null,
        errorCode: "receive_failed",
        errorMessage: safeFailureMessage(lastError),
        attempts: maximumAttempts,
        failedAt: failed.failedAt,
      });
    } catch (error) {
      logger.error("Transcript import failure alert could not be recorded", {
        sourceMeetingId: packet.meeting.sourceMeetingId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return failed;

    async function safelyResolveFailure(sourceMeetingId: string, resolvedAt: string) {
      try {
        await resolveFailure(sourceMeetingId, resolvedAt);
      } catch (error) {
        logger.error("Transcript import failure alert could not be resolved", {
          sourceMeetingId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}

function safeFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 2_000) || "Transcript import failed.";
}

function createSourceFingerprint(packet: TranscriptWebhookPacket): string {
  return JSON.stringify({
    meeting: packet.meeting,
    attendees: packet.attendees,
    transcript: packet.transcript,
  });
}

function logContext(result: TranscriptWebhookResult): Record<string, unknown> {
  return {
    eventId: result.eventId,
    sourceMeetingId: result.sourceMeetingId,
    sourceTranscriptId: result.sourceTranscriptId,
    attempts: result.attempts,
  };
}

export const receiveTranscript = createTranscriptReceiver({
  processTranscript: storeTranscriptImport,
  startAnalysis: scheduleMeetingAnalysis,
  recordFailure: transcriptImportAlertService.recordFailure,
  resolveFailure: transcriptImportAlertService.resolveFailure,
});
