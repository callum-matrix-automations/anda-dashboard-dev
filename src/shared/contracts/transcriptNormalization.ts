import { z } from "zod";

export const TranscriptFormatSchema = z.enum([
  "speaker_colon",
  "timestamp_speaker_blocks",
  "timestamped_speaker_lines",
  "webvtt",
  "srt",
  "unknown",
]);

export const TranscriptNormalizationMethodSchema = z.enum([
  "deterministic",
  "gpt-6-luna",
]);

export const TranscriptNormalizationWarningCodeSchema = z.enum([
  "generic_speakers",
  "possible_aliases",
  "low_attribution_coverage",
  "unrecognized_format",
]);

export const TranscriptNormalizationWarningSchema = z.object({
  code: TranscriptNormalizationWarningCodeSchema,
  severity: z.enum(["info", "warning"]),
  message: z.string().trim().min(1),
}).strict();

export const TranscriptParticipantSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  kind: z.enum(["named", "generic"]),
}).strict();

export const TranscriptAliasCandidateSchema = z.object({
  first: z.string().trim().min(1),
  second: z.string().trim().min(1),
}).strict();

export const TranscriptNormalizationSummarySchema = z.object({
  method: TranscriptNormalizationMethodSchema,
  detectedFormat: TranscriptFormatSchema,
  participants: z.array(TranscriptParticipantSchema).max(1_000),
  possibleAliases: z.array(TranscriptAliasCandidateSchema).max(1_000),
  warnings: z.array(TranscriptNormalizationWarningSchema).max(20),
  turnCount: z.number().int().positive(),
  attributionCoverage: z.number().min(0).max(1),
}).strict();

export const TranscriptNormalizationResultSchema = TranscriptNormalizationSummarySchema.extend({
  canonicalTranscript: z.string().trim().min(1).max(1_000_000),
  originalContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  normalizedContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  model: z.string().trim().min(1).nullable(),
  responseId: z.string().trim().min(1).nullable(),
  requestId: z.string().trim().min(1).nullable(),
}).strict();

export const TranscriptNormalizationTurnSchema = z.object({
  speaker: z.string().trim().min(1).max(200),
  dialogue: z.string().trim().min(1).max(100_000),
}).strict();

export const TranscriptNormalizationAiOutputSchema = z.object({
  turns: z.array(TranscriptNormalizationTurnSchema).min(1).max(20_000),
}).strict();

export const TRANSCRIPT_NORMALIZATION_AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      minItems: 1,
      maxItems: 20_000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "dialogue"],
        properties: {
          speaker: { type: "string", minLength: 1, maxLength: 200 },
          dialogue: { type: "string", minLength: 1, maxLength: 100_000 },
        },
      },
    },
  },
} as const;

export type TranscriptFormat = z.infer<typeof TranscriptFormatSchema>;
export type TranscriptNormalizationMethod = z.infer<typeof TranscriptNormalizationMethodSchema>;
export type TranscriptNormalizationWarning = z.infer<typeof TranscriptNormalizationWarningSchema>;
export type TranscriptParticipant = z.infer<typeof TranscriptParticipantSchema>;
export type TranscriptAliasCandidate = z.infer<typeof TranscriptAliasCandidateSchema>;
export type TranscriptNormalizationSummary = z.infer<typeof TranscriptNormalizationSummarySchema>;
export type TranscriptNormalizationResult = z.infer<typeof TranscriptNormalizationResultSchema>;
export type TranscriptNormalizationTurn = z.infer<typeof TranscriptNormalizationTurnSchema>;
