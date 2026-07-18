import type {
  TranscriptReceivedResult,
  TranscriptWebhookPacket,
  TranscriptWebhookResult,
} from "@/shared/contracts/transcriptWebhook";
import type { StoredTranscriptImport } from "../../repositories/transcripts/transcriptRepository";
import { storeTranscriptImport } from "./storeTranscriptImport";

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
          return {
            status: "duplicate",
            eventId: packet.eventId,
            sourceMeetingId: packet.meeting.sourceMeetingId,
            sourceTranscriptId: packet.transcript.sourceTranscriptId,
            attempts: 0,
            firstReceivedAt: processed.importedAt,
          };
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
    return failed;
  };
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

export const receiveTranscript = createTranscriptReceiver({ processTranscript: storeTranscriptImport });
