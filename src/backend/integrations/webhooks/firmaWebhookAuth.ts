import { createHmac, timingSafeEqual } from "node:crypto";

export const FIRMA_SIGNATURE_HEADER = "x-firma-signature";
export const FIRMA_OLD_SIGNATURE_HEADER = "x-firma-signature-old";
export const FIRMA_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function createFirmaWebhookSignature(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

export function verifyFirmaWebhookSignature({
  currentSecret,
  previousSecret,
  signatureHeader,
  oldSignatureHeader,
  rawBody,
  now = () => new Date(),
}: {
  currentSecret: string;
  previousSecret?: string;
  signatureHeader: string | null;
  oldSignatureHeader: string | null;
  rawBody: string;
  now?: () => Date;
}): { ok: true } | { ok: false; reason: string } {
  const current = parseSignatureHeader(signatureHeader);
  const previous = parseSignatureHeader(oldSignatureHeader);
  if (!current && !previous) {
    return { ok: false, reason: "Firma webhook signature is missing or malformed." };
  }

  const candidates = [
    current ? { parsed: current, secret: currentSecret } : null,
    previous && previousSecret ? { parsed: previous, secret: previousSecret } : null,
  ].filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  for (const candidate of candidates) {
    const timestamp = Number(candidate.parsed.timestamp);
    if (!Number.isSafeInteger(timestamp)) continue;
    const nowSeconds = Math.floor(now().getTime() / 1_000);
    if (Math.abs(nowSeconds - timestamp) > FIRMA_WEBHOOK_TOLERANCE_SECONDS) continue;
    const expected = Buffer.from(createFirmaWebhookSignature(
      candidate.secret,
      candidate.parsed.timestamp,
      rawBody,
    ), "hex");
    const actual = Buffer.from(candidate.parsed.signature, "hex");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return { ok: true };
  }
  return { ok: false, reason: "Firma webhook signature is invalid or expired." };
}

function parseSignatureHeader(value: string | null) {
  if (!value) return null;
  const entries = new Map(
    value.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = entries.get("t");
  const signature = entries.get("v1");
  if (!timestamp || !/^\d+$/u.test(timestamp) || !signature || !/^[a-f0-9]{64}$/iu.test(signature)) {
    return null;
  }
  return { timestamp, signature: signature.toLocaleLowerCase("en") };
}
