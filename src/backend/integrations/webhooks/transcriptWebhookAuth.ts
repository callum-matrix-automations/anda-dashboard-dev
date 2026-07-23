import { createHmac, timingSafeEqual } from "node:crypto";

export const READ_AI_SIGNATURE_HEADER = "x-read-signature";

export function createReadAiWebhookSignature(signingKey: string, rawBody: string): string {
  const key = decodeSigningKey(signingKey);
  return createHmac("sha256", key).update(rawBody, "utf8").digest("hex");
}

export function verifyReadAiWebhookSignature({
  signingKey,
  signature,
  rawBody,
}: {
  signingKey: string;
  signature: string | null;
  rawBody: string;
}): { ok: true } | { ok: false; reason: string } {
  if (!signature) return { ok: false, reason: "Read AI webhook signature is required." };
  if (!/^[a-f0-9]{64}$/iu.test(signature)) {
    return { ok: false, reason: "Read AI webhook signature is malformed." };
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(createReadAiWebhookSignature(signingKey, rawBody), "hex");
  } catch {
    return { ok: false, reason: "Read AI webhook signing key is invalid." };
  }
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "Read AI webhook signature is invalid." };
  }
  return { ok: true };
}

function decodeSigningKey(signingKey: string): Buffer {
  const value = signingKey.trim();
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value) || value.length % 4 !== 0) {
    throw new Error("Read AI webhook signing key must be valid Base64.");
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length < 16 || decoded.toString("base64") !== value) {
    throw new Error("Read AI webhook signing key must decode to at least 16 bytes.");
  }
  return decoded;
}
