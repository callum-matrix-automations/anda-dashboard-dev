import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createSupabaseMeetingAnalysisRepository } from "../../src/backend/repositories/supabase/supabaseMeetingAnalysisRepository";
import { createSupabaseTranscriptRepository } from "../../src/backend/repositories/supabase/supabaseTranscriptRepository";
import { createMeetingAnalysisProcessor } from "../../src/backend/services/ai/processMeetingAnalysis";
import { createTranscriptReceiver } from "../../src/backend/services/transcripts/receiveTranscript";
import { createTranscriptImportStore } from "../../src/backend/services/transcripts/storeTranscriptImport";
import { createTranscriptWebhookHandler } from "../../src/backend/integrations/webhooks/transcriptWebhookHandler";
import {
  createReadAiWebhookSignature,
  READ_AI_SIGNATURE_HEADER,
} from "../../src/backend/integrations/webhooks/transcriptWebhookAuth";
import { adaptReadAiWebhook } from "../../src/backend/integrations/read-ai/readAiTranscriptAdapter";
import {
  MeetingDraftSchema,
  type MeetingAnalysisInput,
  type MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";
import {
  TranscriptWebhookResultSchema,
  type TranscriptWebhookPacket,
} from "../../src/shared/contracts/transcriptWebhook";
import {
  ReadAiMeetingEndWebhookSchema,
  type ReadAiMeetingEndWebhook,
} from "../../src/shared/contracts/readAiWebhook";

const MeetingRowSchema = z.object({
  id: z.string().uuid(),
  source_meeting_id: z.string(),
  status: z.string(),
  minutes: z.unknown(),
  analysis_attempt: z.number().int(),
  analysis_run_id: z.string().uuid().nullable(),
  human_owned: z.boolean(),
  last_error_code: z.string().nullable(),
});

const TranscriptRowSchema = z.object({
  id: z.string().uuid(),
  meeting_id: z.string().uuid(),
  source_transcript_id: z.string(),
  content: z.string(),
});

const AttendeeRowSchema = z.object({
  profile_id: z.string().uuid(),
  display_name_snapshot: z.string(),
});

const MotionRowSchema = z.object({
  id: z.string().uuid(),
  motion_text: z.string(),
  outcome: z.string().nullable(),
});

const VoteRowSchema = z.object({
  motion_id: z.string().uuid(),
  attendee_id: z.string().uuid(),
  selection: z.string().nullable(),
});

export type WorkflowAnalyzer = (input: MeetingAnalysisInput) => Promise<MeetingDraft>;

export interface PreApprovalWorkflowResult {
  packet: TranscriptWebhookPacket;
  analysisInput: MeetingAnalysisInput;
  draft: MeetingDraft;
  receipt: z.infer<typeof TranscriptWebhookResultSchema>;
  responseStatus: number;
  duplicateReceipt: z.infer<typeof TranscriptWebhookResultSchema>;
  duplicateResponseStatus: number;
  duplicateAnalysisStarts: number;
  meetings: z.infer<typeof MeetingRowSchema>[];
  transcripts: z.infer<typeof TranscriptRowSchema>[];
  attendees: z.infer<typeof AttendeeRowSchema>[];
  motions: z.infer<typeof MotionRowSchema>[];
  votes: z.infer<typeof VoteRowSchema>[];
}

export function localSupabaseConfiguration() {
  const apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  return {
    apiUrl,
    secretKey,
    configured: isLoopbackUrl(apiUrl) && Boolean(secretKey) && !secretKey.startsWith("replace-"),
  };
}

export async function loadPredefinedMeetingDraft(): Promise<MeetingDraft> {
  const source = await readFile("fixtures/analysis/predefined-meeting-analysis.json", "utf8");
  return MeetingDraftSchema.parse(JSON.parse(source));
}

export async function runPreApprovalWorkflow({
  analyze,
  idPrefix,
}: {
  analyze: WorkflowAnalyzer;
  idPrefix: string;
}): Promise<PreApprovalWorkflowResult> {
  const { apiUrl, secretKey, configured } = localSupabaseConfiguration();
  if (!configured) throw new Error("The pre-approval workflow test requires a configured local Supabase instance.");

  const readAiPayload = await createUniqueReadAiPayload(idPrefix);
  const adapted = adaptReadAiWebhook(readAiPayload, {
    receivedAt: () => new Date("2026-07-25T19:00:01.000Z"),
  });
  if (adapted.status !== "ready") throw new Error("The meeting_end fixture was unexpectedly ignored.");
  const packet = adapted.packet;
  const webhookSigningKey = Buffer.from(`workflow-secret-${randomUUID()}-read-ai`).toString("base64");
  const transcriptRepository = createSupabaseTranscriptRepository({ apiUrl, secretKey });
  const analysisRepository = createSupabaseMeetingAnalysisRepository({ apiUrl, secretKey });
  const storeTranscript = createTranscriptImportStore(transcriptRepository);
  let analysisInput: MeetingAnalysisInput | undefined;
  let draft: MeetingDraft | undefined;

  const processAnalysis = createMeetingAnalysisProcessor({
    repository: analysisRepository,
    analyze: async (input) => {
      analysisInput = input;
      draft = MeetingDraftSchema.parse(await analyze(input));
      return draft;
    },
    delay: async () => undefined,
  });
  const receiveTranscript = createTranscriptReceiver({
    processTranscript: storeTranscript,
    startAnalysis: async (meetingId) => {
      const result = await processAnalysis(meetingId);
      if (result.status !== "completed") {
        throw new Error(`Expected analysis to complete, received ${result.status}.`);
      }
      return result;
    },
    delay: async () => undefined,
    logger: silentLogger,
  });
  const webhook = createTranscriptWebhookHandler(receiveTranscript);
  const response = await withReadAiSigningKey(
    webhookSigningKey,
    () => webhook(signedRequest(readAiPayload, webhookSigningKey)),
  );
  const receipt = TranscriptWebhookResultSchema.parse(await response.json());

  if (!analysisInput || !draft) {
    throw new Error("The webhook completed without invoking meeting analysis.");
  }

  const meetings = MeetingRowSchema.array().parse(await selectRows({
    apiUrl,
    secretKey,
    table: "meetings",
    column: "source_meeting_id",
    value: packet.meeting.sourceMeetingId,
    select: "id,source_meeting_id,status,minutes,analysis_attempt,analysis_run_id,human_owned,last_error_code",
  }));
  const meeting = meetings[0];
  if (!meeting) throw new Error("The workflow did not create a meeting.");

  const transcripts = TranscriptRowSchema.array().parse(await selectRows({
    apiUrl,
    secretKey,
    table: "transcripts",
    column: "source_transcript_id",
    value: packet.transcript.sourceTranscriptId,
    select: "id,meeting_id,source_transcript_id,content",
  }));
  const attendees = AttendeeRowSchema.array().parse(await selectRows({
    apiUrl,
    secretKey,
    table: "meeting_attendees",
    column: "meeting_id",
    value: meeting.id,
    select: "profile_id,display_name_snapshot",
  }));
  const motions = MotionRowSchema.array().parse(await selectRows({
    apiUrl,
    secretKey,
    table: "motions",
    column: "meeting_id",
    value: meeting.id,
    select: "id,motion_text,outcome",
  }));
  const votes = VoteRowSchema.array().parse(await selectRows({
    apiUrl,
    secretKey,
    table: "votes",
    column: "meeting_id",
    value: meeting.id,
    select: "motion_id,attendee_id,selection",
  }));

  let duplicateAnalysisStarts = 0;
  const freshReceiver = createTranscriptReceiver({
    processTranscript: storeTranscript,
    startAnalysis: async () => {
      duplicateAnalysisStarts += 1;
    },
    delay: async () => undefined,
    logger: silentLogger,
  });
  const duplicateWebhook = createTranscriptWebhookHandler(freshReceiver);
  const duplicateResponse = await withReadAiSigningKey(
    webhookSigningKey,
    () => duplicateWebhook(signedRequest(readAiPayload, webhookSigningKey)),
  );
  const duplicateReceipt = TranscriptWebhookResultSchema.parse(await duplicateResponse.json());

  return {
    packet,
    analysisInput,
    draft,
    receipt,
    responseStatus: response.status,
    duplicateReceipt,
    duplicateResponseStatus: duplicateResponse.status,
    duplicateAnalysisStarts,
    meetings,
    transcripts,
    attendees,
    motions,
    votes,
  };
}

export async function createUniqueReadAiPayload(idPrefix: string): Promise<ReadAiMeetingEndWebhook> {
  const [metadataSource, transcriptContent] = await Promise.all([
    readFile("fixtures/transcripts/dummy-transcript-packet.json", "utf8"),
    readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8"),
  ]);
  const metadata = JSON.parse(metadataSource) as Record<string, unknown> & {
    start_time: string;
    end_time: string;
    transcript: Record<string, unknown>;
  };
  const uniqueId = `${idPrefix}-${randomUUID()}`;
  const sessionId = `read-ai-${uniqueId}`;
  return ReadAiMeetingEndWebhookSchema.parse({
    ...metadata,
    session_id: sessionId,
    request_id: `request-${uniqueId}`,
    platform_meeting_id: `platform-${uniqueId}`,
    report_url: `https://app.read.ai/analytics/meetings/${encodeURIComponent(sessionId)}`,
    transcript: {
      ...metadata.transcript,
      speaker_blocks: buildSpeakerBlocks(
        transcriptContent,
        metadata.start_time,
        metadata.end_time,
      ),
    },
  });
}

function signedRequest(payload: ReadAiMeetingEndWebhook, signingKey: string): Request {
  const rawBody = JSON.stringify(payload);
  return new Request("http://localhost:3000/api/webhooks/transcripts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [READ_AI_SIGNATURE_HEADER]: createReadAiWebhookSignature(signingKey, rawBody),
    },
    body: rawBody,
  });
}

async function withReadAiSigningKey<T>(signingKey: string, operation: () => Promise<T>): Promise<T> {
  const previousSigningKey = process.env.READ_AI_WEBHOOK_SIGNING_KEY;
  process.env.READ_AI_WEBHOOK_SIGNING_KEY = signingKey;
  try {
    return await operation();
  } finally {
    if (previousSigningKey === undefined) delete process.env.READ_AI_WEBHOOK_SIGNING_KEY;
    else process.env.READ_AI_WEBHOOK_SIGNING_KEY = previousSigningKey;
  }
}

function buildSpeakerBlocks(content: string, startTime: string, endTime: string) {
  const turns = content.split(/\r?\n\s*\r?\n/gu).map((turn) => turn.trim()).filter(Boolean);
  const meetingStart = Date.parse(startTime);
  const meetingEnd = Date.parse(endTime);
  if (turns.length === 0 || !Number.isFinite(meetingStart) || !Number.isFinite(meetingEnd)) {
    throw new Error("The Read AI workflow fixture cannot be converted into speaker blocks.");
  }
  const interval = Math.floor((meetingEnd - meetingStart) / turns.length);
  return turns.map((turn, index) => {
    const separator = turn.indexOf(":");
    const speaker = separator > 0 ? turn.slice(0, separator).trim() : "Unknown Speaker";
    const words = separator > 0 ? turn.slice(separator + 1).trim() : turn;
    const blockStart = meetingStart + (interval * index);
    const blockEnd = Math.min(meetingEnd, blockStart + Math.max(1_000, Math.floor(interval * 0.9)));
    return {
      start_time: String(blockStart),
      end_time: String(blockEnd),
      speaker: { name: speaker },
      words,
    };
  });
}

async function selectRows({
  apiUrl,
  secretKey,
  table,
  column,
  value,
  select,
}: {
  apiUrl: string;
  secretKey: string;
  table: string;
  column: string;
  value: string;
  select: string;
}): Promise<unknown> {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  url.searchParams.set(column, `eq.${value}`);
  url.searchParams.set("select", select);
  const response = await fetch(url, {
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
    },
  });
  if (!response.ok) throw new Error(`Local Supabase ${table} query failed with HTTP ${response.status}.`);
  return response.json();
}

function isLoopbackUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

const silentLogger = {
  info: () => undefined,
  error: () => undefined,
};
