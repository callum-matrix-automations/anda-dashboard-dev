import { receiveTranscript } from "../../services/transcripts/receiveTranscript";
import {
  TRANSCRIPT_SIGNATURE_HEADER,
  TRANSCRIPT_TIMESTAMP_HEADER,
  verifyTranscriptWebhookSignature,
} from "./transcriptWebhookAuth";
import {
  MAX_TRANSCRIPT_WEBHOOK_BYTES,
  TranscriptWebhookPacketSchema,
} from "../../../shared/contracts/transcriptWebhook";
import type {
  TranscriptWebhookPacket,
  TranscriptWebhookResult,
} from "../../../shared/contracts/transcriptWebhook";

export type TranscriptWebhookReceiver = (
  packet: TranscriptWebhookPacket,
) => Promise<TranscriptWebhookResult>;

export function createTranscriptWebhookHandler(receive: TranscriptWebhookReceiver = receiveTranscript) {
  return async function handleTranscriptWebhook(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TRANSCRIPT_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Transcript webhook payload is too large.");
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return errorResponse(400, "invalid_body", "Transcript webhook body could not be read.");
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_TRANSCRIPT_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Transcript webhook payload is too large.");
    }

    const secret = process.env.TRANSCRIPT_WEBHOOK_SECRET;
    if (!secret) return errorResponse(503, "webhook_not_configured", "Transcript webhook authentication is not configured.");
    const authentication = verifyTranscriptWebhookSignature({
      secret,
      timestamp: request.headers.get(TRANSCRIPT_TIMESTAMP_HEADER),
      signature: request.headers.get(TRANSCRIPT_SIGNATURE_HEADER),
      rawBody,
    });
    if (!authentication.ok) return errorResponse(401, "invalid_signature", authentication.reason);

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return errorResponse(400, "invalid_json", "Transcript webhook body must be valid JSON.");
    }
    const parsed = TranscriptWebhookPacketSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({
        error: "invalid_transcript_packet",
        message: "Transcript webhook payload does not match the expected contract.",
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      }, { status: 422 });
    }

    const result = await receive(parsed.data);
    if (result.status === "failed") return Response.json(result, { status: 503 });
    return Response.json(result, { status: result.status === "duplicate" ? 200 : 202 });
  };
}

function errorResponse(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

export const handleTranscriptWebhook = createTranscriptWebhookHandler();
