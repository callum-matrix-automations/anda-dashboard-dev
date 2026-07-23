import { z } from "zod";

const ReadAiTimestampMsSchema = z.union([
  z.string().regex(/^\d+$/u),
  z.number().int().nonnegative(),
]);

export const ReadAiPersonSchema = z.object({
  name: z.string().trim().min(1).max(500),
  first_name: z.string().trim().min(1).max(250).nullable().optional(),
  last_name: z.string().trim().min(1).max(250).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
}).passthrough();

export const ReadAiSpeakerBlockSchema = z.object({
  start_time: ReadAiTimestampMsSchema,
  end_time: ReadAiTimestampMsSchema,
  speaker: z.object({
    name: z.string().trim().min(1).max(500),
  }).passthrough(),
  words: z.string(),
}).passthrough();

const ReadAiBaseWebhookSchema = z.object({
  session_id: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(500),
  start_time: z.string().datetime({ offset: true }),
  owner: ReadAiPersonSchema,
  platform: z.string().trim().min(1).max(100),
  platform_meeting_id: z.string().trim().min(1).max(500),
  request_id: z.string().trim().min(1).max(500),
});

const ReadAiTextItemSchema = z.object({
  text: z.string(),
}).passthrough();

const ReadAiChapterSchema = z.object({
  title: z.string(),
  description: z.string(),
  topics: z.array(ReadAiTextItemSchema),
}).passthrough();

export const ReadAiMeetingStartWebhookSchema = ReadAiBaseWebhookSchema.extend({
  trigger: z.literal("meeting_start"),
}).passthrough();

export const ReadAiMeetingEndWebhookSchema = ReadAiBaseWebhookSchema.extend({
  trigger: z.literal("meeting_end"),
  end_time: z.string().datetime({ offset: true }),
  participants: z.array(ReadAiPersonSchema).max(1_000),
  summary: z.string().nullable(),
  action_items: z.array(ReadAiTextItemSchema),
  key_questions: z.array(ReadAiTextItemSchema),
  topics: z.array(ReadAiTextItemSchema),
  report_url: z.string().url(),
  chapter_summaries: z.array(ReadAiChapterSchema),
  transcript: z.object({
    speaker_blocks: z.array(ReadAiSpeakerBlockSchema).max(100_000),
    speakers: z.array(z.object({
      name: z.string().trim().min(1).max(500),
    }).passthrough()).max(1_000),
  }).passthrough(),
}).passthrough();

export const ReadAiWebhookPayloadSchema = z.discriminatedUnion("trigger", [
  ReadAiMeetingStartWebhookSchema,
  ReadAiMeetingEndWebhookSchema,
]);

export type ReadAiPerson = z.infer<typeof ReadAiPersonSchema>;
export type ReadAiMeetingEndWebhook = z.infer<typeof ReadAiMeetingEndWebhookSchema>;
export type ReadAiWebhookPayload = z.infer<typeof ReadAiWebhookPayloadSchema>;
