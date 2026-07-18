import type {
  TranscriptReceivedResult,
  TranscriptWebhookPacket,
  TranscriptWebhookResult,
} from "@/shared/contracts/transcriptWebhook";

export const MAX_RECEIVE_RETRIES = 3;
const DEFAULT_RETRY_DELAYS_MS = [100, 250, 500] as const;

interface ReceiptLogger {
  info(message: string, context: Record<string, unknown>): void;
  error(message: string, context: Record<string, unknown>): void;
}

interface TranscriptReceiverOptions {
  processTranscript?: (packet: TranscriptWebhookPacket) => Promise<void>;
  now?: () => Date;
  logger?: ReceiptLogger;
  delay?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

export function createTranscriptReceiver({
  processTranscript = async () => undefined,
  now = () => new Date(),
  logger = console,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
}: TranscriptReceiverOptions = {}) {
  const completed = new Map<string, TranscriptReceivedResult>();

  return async function receive(packet: TranscriptWebhookPacket): Promise<TranscriptWebhookResult> {
    const idempotencyKey = packet.transcript.sourceTranscriptId;
    const existing = completed.get(idempotencyKey);
    if (existing) {
      return {
        status: "duplicate",
        eventId: packet.eventId,
        sourceMeetingId: packet.meeting.sourceMeetingId,
        sourceTranscriptId: packet.transcript.sourceTranscriptId,
        attempts: 0,
        firstReceivedAt: existing.receivedAt,
      };
    }

    let lastError: unknown;
    const maximumAttempts = MAX_RECEIVE_RETRIES + 1;
    for (let attempts = 1; attempts <= maximumAttempts; attempts += 1) {
      try {
        await processTranscript(packet);
        const received: TranscriptReceivedResult = {
          status: "received",
          eventId: packet.eventId,
          sourceMeetingId: packet.meeting.sourceMeetingId,
          sourceTranscriptId: packet.transcript.sourceTranscriptId,
          transcriptCharacters: packet.transcript.content.length,
          attempts,
          receivedAt: now().toISOString(),
        };
        completed.set(idempotencyKey, received);
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

function logContext(result: TranscriptWebhookResult): Record<string, unknown> {
  return {
    eventId: result.eventId,
    sourceMeetingId: result.sourceMeetingId,
    sourceTranscriptId: result.sourceTranscriptId,
    attempts: result.attempts,
  };
}

export const receiveTranscript = createTranscriptReceiver();
