import { createHash } from "node:crypto";
import type { MeetingSigningOutcomeRepository } from "../../repositories/signing/meetingSigningOutcomeRepository";
import { supabaseMeetingSigningOutcomeRepository } from "../../repositories/supabase/supabaseMeetingSigningOutcomeRepository";
import { processFirmaWebhookEvent } from "../../services/signing/processSigningOutcome";
import { FirmaWebhookEventSchema } from "../../../shared/contracts/meetingSigning";
import {
  FIRMA_OLD_SIGNATURE_HEADER,
  FIRMA_SIGNATURE_HEADER,
  verifyFirmaWebhookSignature,
} from "./firmaWebhookAuth";

export const MAX_FIRMA_WEBHOOK_BYTES = 1_048_576;
export const FIRMA_EVENT_HEADER = "x-firma-event";

type Schedule = (work: () => Promise<void>) => void;

export function createFirmaWebhookHandler({
  repository = supabaseMeetingSigningOutcomeRepository,
  processEvent = processFirmaWebhookEvent,
  schedule = (work) => { void work(); },
}: {
  repository?: MeetingSigningOutcomeRepository;
  processEvent?: (eventId: string) => Promise<unknown>;
  schedule?: Schedule;
} = {}) {
  return async function handleFirmaWebhook(request: Request): Promise<Response> {
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FIRMA_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Firma webhook payload is too large.");
    }

    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return errorResponse(400, "invalid_body", "Firma webhook body could not be read.");
    }
    if (new TextEncoder().encode(rawBody).byteLength > MAX_FIRMA_WEBHOOK_BYTES) {
      return errorResponse(413, "payload_too_large", "Firma webhook payload is too large.");
    }

    const currentSecret = process.env.FIRMA_WEBHOOK_SECRET;
    if (!currentSecret?.trim()) {
      return errorResponse(503, "webhook_not_configured", "Firma webhook authentication is not configured.");
    }
    const verified = verifyFirmaWebhookSignature({
      currentSecret: currentSecret.trim(),
      previousSecret: process.env.FIRMA_WEBHOOK_SECRET_PREVIOUS?.trim(),
      signatureHeader: request.headers.get(FIRMA_SIGNATURE_HEADER),
      oldSignatureHeader: request.headers.get(FIRMA_OLD_SIGNATURE_HEADER),
      rawBody,
    });
    if (!verified.ok) return errorResponse(401, "invalid_signature", verified.reason);
    if (request.headers.get(FIRMA_EVENT_HEADER)?.trim().toLocaleLowerCase("en") === "webhook.test") {
      return Response.json({ status: "verified" });
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return errorResponse(400, "invalid_json", "Firma webhook body must be valid JSON.");
    }
    const event = FirmaWebhookEventSchema.safeParse(json);
    if (!event.success) {
      return Response.json({
        error: "invalid_firma_event",
        message: "Firma webhook payload does not match the expected contract.",
        issues: event.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }, { status: 422 });
    }

    try {
      const receipt = await repository.receiveWebhook(
        event.data,
        extractSigningRequestId(event.data),
        createHash("sha256").update(rawBody, "utf8").digest("hex"),
      );
      if (receipt.status === "conflict") {
        return errorResponse(409, "event_conflict", "Firma event ID was already used for different content.");
      }
      if (receipt.status === "accepted" || receipt.status === "retry") {
        schedule(async () => {
          await processEvent(event.data.id);
        });
      }
      return Response.json(receipt, {
        status: receipt.status === "accepted" || receipt.status === "retry" ? 202 : 200,
      });
    } catch {
      return errorResponse(503, "webhook_persistence_failed", "Firma webhook event could not be saved.");
    }
  };
}

export function extractSigningRequestId(event: Record<string, unknown>): string | null {
  if (typeof event.signing_request_id === "string" && event.signing_request_id.trim()) {
    return event.signing_request_id.trim();
  }
  if (!isRecord(event.data)) return null;
  if (typeof event.data.signing_request_id === "string" && event.data.signing_request_id.trim()) {
    return event.data.signing_request_id.trim();
  }
  if (isRecord(event.data.signing_request) && typeof event.data.signing_request.id === "string") {
    return event.data.signing_request.id.trim() || null;
  }
  if (isRecord(event.data.request) && typeof event.data.request.id === "string") {
    return event.data.request.id.trim() || null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorResponse(status: number, error: string, message: string) {
  return Response.json({ error, message }, { status });
}

export const handleFirmaWebhook = createFirmaWebhookHandler();
