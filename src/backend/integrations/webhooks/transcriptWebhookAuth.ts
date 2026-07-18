import { createHmac, timingSafeEqual } from "node:crypto";

export const TRANSCRIPT_SIGNATURE_HEADER = "x-anda-webhook-signature";
export const TRANSCRIPT_TIMESTAMP_HEADER = "x-anda-webhook-timestamp";
export const WEBHOOK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1_000;

export function createTranscriptWebhookSignature(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

export function verifyTranscriptWebhookSignature({
  secret,
  timestamp,
  signature,
  rawBody,
  now = () => new Date(),
}: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: () => Date;
}): { ok: true } | { ok: false; reason: string } {
  if (!timestamp || !signature) return { ok: false, reason: "Webhook signature headers are required." };
  if (!/^\d+$/.test(timestamp)) return { ok: false, reason: "Webhook timestamp is invalid." };

  const timestampMs = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(timestampMs)) return { ok: false, reason: "Webhook timestamp is invalid." };
  if (Math.abs(now().getTime() - timestampMs) > WEBHOOK_TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, reason: "Webhook timestamp is outside the allowed window." };
  }

  const expected = Buffer.from(createTranscriptWebhookSignature(secret, timestamp, rawBody));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "Webhook signature is invalid." };
  }

  return { ok: true };
}
