import { z } from "zod";

export const MAX_TRANSCRIPT_WEBHOOK_BYTES = 1_048_576;

export const TranscriptWebhookPacketSchema = z.object({
  eventId: z.string().trim().min(1).max(200),
  eventType: z.literal("transcript.ready"),
  occurredAt: z.string().datetime({ offset: true }),
  sentAt: z.string().datetime({ offset: true }),
  meeting: z.object({
    sourceMeetingId: z.string().trim().min(1).max(500),
    title: z.string().trim().min(1).max(500),
    startedAt: z.string().datetime({ offset: true }),
    endedAt: z.string().datetime({ offset: true }),
  }).strict(),
  transcript: z.object({
    sourceTranscriptId: z.string().trim().min(1).max(500),
    contentType: z.literal("text/plain"),
    language: z.string().trim().min(1).max(50),
    content: z.string().trim().min(1).max(MAX_TRANSCRIPT_WEBHOOK_BYTES),
  }).strict(),
}).strict();

export type TranscriptWebhookPacket = z.infer<typeof TranscriptWebhookPacketSchema>;

const receiptIdentity = {
  eventId: z.string(),
  sourceMeetingId: z.string(),
  sourceTranscriptId: z.string(),
};

export const TranscriptWebhookResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("received"),
    ...receiptIdentity,
    transcriptCharacters: z.number().int().nonnegative(),
    attempts: z.number().int().positive(),
    receivedAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    status: z.literal("duplicate"),
    ...receiptIdentity,
    attempts: z.literal(0),
    firstReceivedAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    status: z.literal("failed"),
    ...receiptIdentity,
    attempts: z.number().int().positive(),
    failedAt: z.string().datetime({ offset: true }),
    error: z.object({ code: z.literal("receive_failed"), message: z.string() }),
  }),
]);

export type TranscriptWebhookResult = z.infer<typeof TranscriptWebhookResultSchema>;
export type TranscriptReceivedResult = Extract<TranscriptWebhookResult, { status: "received" }>;
