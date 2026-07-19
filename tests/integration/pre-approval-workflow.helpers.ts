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
  createTranscriptWebhookSignature,
  TRANSCRIPT_SIGNATURE_HEADER,
  TRANSCRIPT_TIMESTAMP_HEADER,
} from "../../src/backend/integrations/webhooks/transcriptWebhookAuth";
import {
  MeetingDraftSchema,
  type MeetingAnalysisInput,
  type MeetingDraft,
} from "../../src/shared/contracts/meetingAnalysis";
import {
  TranscriptWebhookPacketSchema,
  TranscriptWebhookResultSchema,
  type TranscriptWebhookPacket,
} from "../../src/shared/contracts/transcriptWebhook";

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

  const packet = await createUniquePacket(idPrefix);
  const webhookSecret = `workflow-secret-${randomUUID()}`;
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
  const response = await withWebhookSecret(webhookSecret, () => webhook(signedRequest(packet, webhookSecret)));
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
  const duplicateResponse = await withWebhookSecret(
    webhookSecret,
    () => duplicateWebhook(signedRequest(packet, webhookSecret)),
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

async function createUniquePacket(idPrefix: string): Promise<TranscriptWebhookPacket> {
  const [metadataSource, transcriptContent] = await Promise.all([
    readFile("fixtures/transcripts/dummy-transcript-packet.json", "utf8"),
    readFile("fixtures/transcripts/anda-board-meeting.txt", "utf8"),
  ]);
  const metadata = JSON.parse(metadataSource) as {
    eventId: string;
    eventType: string;
    occurredAt: string;
    meeting: Record<string, unknown>;
    attendees: unknown[];
    transcript: Record<string, unknown>;
  };
  const uniqueId = `${idPrefix}-${randomUUID()}`;
  return TranscriptWebhookPacketSchema.parse({
    ...metadata,
    eventId: `event-${uniqueId}`,
    sentAt: new Date().toISOString(),
    meeting: {
      ...metadata.meeting,
      sourceMeetingId: `meeting-${uniqueId}`,
    },
    transcript: {
      ...metadata.transcript,
      sourceTranscriptId: `transcript-${uniqueId}`,
      content: transcriptContent,
    },
  });
}

function signedRequest(packet: TranscriptWebhookPacket, secret: string): Request {
  const rawBody = JSON.stringify(packet);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  return new Request("http://localhost:3000/api/webhooks/transcripts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TRANSCRIPT_TIMESTAMP_HEADER]: timestamp,
      [TRANSCRIPT_SIGNATURE_HEADER]: createTranscriptWebhookSignature(secret, timestamp, rawBody),
    },
    body: rawBody,
  });
}

async function withWebhookSecret<T>(secret: string, operation: () => Promise<T>): Promise<T> {
  const previousSecret = process.env.TRANSCRIPT_WEBHOOK_SECRET;
  process.env.TRANSCRIPT_WEBHOOK_SECRET = secret;
  try {
    return await operation();
  } finally {
    if (previousSecret === undefined) delete process.env.TRANSCRIPT_WEBHOOK_SECRET;
    else process.env.TRANSCRIPT_WEBHOOK_SECRET = previousSecret;
  }
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
