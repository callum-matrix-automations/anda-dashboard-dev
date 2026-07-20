import { z } from "zod";

export const MAX_TRANSCRIPT_WEBHOOK_BYTES = 10_485_760;

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
    durationMinutes: z.number().int().positive().max(1_440),
  }).strict(),
  attendees: z.array(z.object({
    displayName: z.string().trim().min(1).max(200),
    email: z.string().trim().email().max(320).nullable().optional(),
  }).strict()).max(250),
  transcript: z.object({
    sourceTranscriptId: z.string().trim().min(1).max(500),
    contentType: z.literal("text/plain"),
    language: z.string().trim().min(1).max(50),
    content: z.string()
      .min(1)
      .max(MAX_TRANSCRIPT_WEBHOOK_BYTES)
      .refine((content) => content.trim().length > 0, { message: "Transcript content must not be blank." }),
    metadata: z.record(z.unknown()).optional(),
  }).strict(),
}).strict().superRefine((packet, context) => {
  const normalizedNames = new Set<string>();
  packet.attendees.forEach((attendee, index) => {
    const normalizedName = normalizeWebhookDisplayName(attendee.displayName);
    if (normalizedNames.has(normalizedName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["attendees", index, "displayName"],
        message: "Attendee display names must be unique after normalization.",
      });
    }
    normalizedNames.add(normalizedName);
  });
});

function normalizeWebhookDisplayName(displayName: string): string {
  return displayName.trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-GB");
}

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
