import { receiveTranscript } from "../../services/transcripts/receiveTranscript";
import { transcriptImportAlertService } from "../../services/transcripts/transcriptImportAlerts";
import {
  adaptReadAiWebhook,
  ReadAiTranscriptAdapterError,
} from "../read-ai/readAiTranscriptAdapter";
import {
  READ_AI_SIGNATURE_HEADER,
  verifyReadAiWebhookSignature,
} from "./transcriptWebhookAuth";
import { ReadAiWebhookPayloadSchema } from "../../../shared/contracts/readAiWebhook";
import {
  MAX_TRANSCRIPT_WEBHOOK_BYTES,
  TranscriptWebhookPacketSchema,
} from "../../../shared/contracts/transcriptWebhook";
import type {
  TranscriptWebhookPacket,
  TranscriptWebhookResult,
} from "../../../shared/contracts/transcriptWebhook";
import type { TranscriptImportFailureRecord } from "../../repositories/transcripts/transcriptRepository";

export type TranscriptWebhookReceiver = (
  packet: TranscriptWebhookPacket,
) => Promise<TranscriptWebhookResult>;

interface TranscriptWebhookHandlerOptions {
  adapt?: typeof adaptReadAiWebhook;
  recordFailure?: (record: TranscriptImportFailureRecord) => Promise<void>;
  now?: () => Date;
  logger?: Pick<Console, "error">;
}

export function createTranscriptWebhookHandler(
  receive: TranscriptWebhookReceiver = receiveTranscript,
  {
    adapt = adaptReadAiWebhook,
    recordFailure = transcriptImportAlertService.recordFailure,
    now = () => new Date(),
    logger = console,
  }: TranscriptWebhookHandlerOptions = {},
) {
  return async function handleTranscriptWebhook(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSCRIPT_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Read AI webhook payload is too large.");
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return errorResponse(400, "invalid_body", "Read AI webhook body could not be read.");
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_TRANSCRIPT_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Read AI webhook payload is too large.");
    }

    const signingKey = process.env.READ_AI_WEBHOOK_SIGNING_KEY;
    if (!signingKey) {
      return errorResponse(503, "webhook_not_configured", "Read AI webhook authentication is not configured.");
    }
    const authentication = verifyReadAiWebhookSignature({
      signingKey,
      signature: request.headers.get(READ_AI_SIGNATURE_HEADER),
      rawBody,
    });
    if (!authentication.ok) return errorResponse(401, "invalid_signature", authentication.reason);

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse(400, "invalid_json", "Read AI webhook body must be valid JSON.");
    }

    const parsed = ReadAiWebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      await recordRejectedImport(body, "invalid_read_ai_payload", "Read AI webhook payload failed validation.", 0);
      return Response.json({
        error: "invalid_read_ai_payload",
        message: "Read AI webhook payload does not match the expected contract.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, { status: 422 });
    }

    let adapted: ReturnType<typeof adaptReadAiWebhook>;
    try {
      adapted = adapt(parsed.data, { receivedAt: now });
    } catch (error) {
      const code = error instanceof ReadAiTranscriptAdapterError ? error.code : "read_ai_adapter_failed";
      const message = error instanceof Error ? error.message : "Read AI transcript adaptation failed.";
      await recordRejectedImport(parsed.data, code, message, 0);
      return errorResponse(422, code, message);
    }

    if (adapted.status === "ignored") {
      return Response.json(adapted, { status: 200 });
    }

    const packet = TranscriptWebhookPacketSchema.safeParse(adapted.packet);
    if (!packet.success) {
      await recordRejectedImport(parsed.data, "invalid_transcript_packet", "Adapted transcript packet failed validation.", 0);
      return errorResponse(422, "invalid_transcript_packet", "Adapted transcript packet is invalid.");
    }

    const result = await receive(packet.data);
    if (result.status === "failed") return Response.json(result, { status: 503 });
    return Response.json(result, { status: result.status === "duplicate" ? 200 : 202 });

    async function recordRejectedImport(
      source: unknown,
      errorCode: string,
      errorMessage: string,
      attempts: number,
    ) {
      const identity = readAiFailureIdentity(source);
      if (!identity) return;
      try {
        await recordFailure({
          ...identity,
          sourceProvider: "read_ai",
          errorCode,
          errorMessage: errorMessage.trim().slice(0, 2_000),
          attempts,
          failedAt: now().toISOString(),
        });
      } catch (error) {
        logger.error("Read AI rejected-import alert could not be recorded", {
          sourceMeetingId: identity.sourceMeetingId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };
}

function readAiFailureIdentity(source: unknown): Pick<
  TranscriptImportFailureRecord,
  "sourceMeetingId" | "requestId" | "title" | "platformMeetingId"
> | null {
  if (!source || typeof source !== "object") return null;
  const value = source as Record<string, unknown>;
  const sessionId = typeof value.session_id === "string" ? value.session_id.trim() : "";
  if (!sessionId) return null;
  return {
    sourceMeetingId: `read_ai:${sessionId}`,
    requestId: typeof value.request_id === "string" ? value.request_id.trim() || null : null,
    title: typeof value.title === "string" ? value.title.trim() || null : null,
    platformMeetingId: typeof value.platform_meeting_id === "string"
      ? value.platform_meeting_id.trim() || null
      : null,
  };
}

function errorResponse(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

export const handleTranscriptWebhook = createTranscriptWebhookHandler();
