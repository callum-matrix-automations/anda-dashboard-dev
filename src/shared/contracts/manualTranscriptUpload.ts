import { z } from "zod";

export const ManualTranscriptUploadRequestSchema = z.object({
  title: z.string().trim().min(1, "Meeting title is required.").max(500),
  meetingDate: z.string().date(),
  durationMinutes: z.number().int().positive().max(1_440),
  transcript: z.string()
    .max(1_000_000)
    .refine((content) => content.trim().length > 0, {
      message: "Transcript content is required.",
    }),
}).strict();

export const ManualTranscriptUploadResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("pending_approval"),
    meetingId: z.string().uuid(),
    analysisAttempt: z.number().int().positive(),
  }).strict(),
  z.object({
    status: z.literal("ai_failed"),
    meetingId: z.string().uuid(),
    analysisAttempts: z.number().int().positive(),
    error: z.object({
      code: z.string().trim().min(1),
      message: z.string().trim().min(1),
    }).strict(),
  }).strict(),
]);

export type ManualTranscriptUploadRequest = z.infer<typeof ManualTranscriptUploadRequestSchema>;
export type ManualTranscriptUploadResponse = z.infer<typeof ManualTranscriptUploadResponseSchema>;
