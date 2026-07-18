import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

export const DEFAULT_FIXTURE_DIRECTORY = resolve(repositoryRoot, "fixtures/transcripts");
export const DEFAULT_TIMEOUT_MS = 10_000;
export const TRANSCRIPT_SIGNATURE_HEADER = "x-anda-webhook-signature";
export const TRANSCRIPT_TIMESTAMP_HEADER = "x-anda-webhook-timestamp";

export async function loadDummyTranscriptFixtures({
  fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY,
} = {}) {
  const [packetSource, transcriptSource] = await Promise.all([
    readFile(resolve(fixtureDirectory, "dummy-transcript-packet.json"), "utf8"),
    readFile(resolve(fixtureDirectory, "anda-board-meeting.txt"), "utf8"),
  ]);

  const metadata = JSON.parse(packetSource);
  const content = transcriptSource.trim();
  if (!content) throw new Error("The dummy transcript fixture is empty.");

  return { metadata, content };
}

export async function buildDummyTranscriptPacket({
  fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY,
  now = () => new Date(),
} = {}) {
  const { metadata, content } = await loadDummyTranscriptFixtures({ fixtureDirectory });

  return {
    ...metadata,
    sentAt: now().toISOString(),
    transcript: {
      ...metadata.transcript,
      content,
    },
  };
}

export async function sendDummyTranscript({
  endpoint = process.env.MOCK_TRANSCRIPT_WEBHOOK_URL,
  secret = process.env.TRANSCRIPT_WEBHOOK_SECRET,
  fetchImplementation = globalThis.fetch,
  fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY,
  now = () => new Date(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!endpoint) {
    throw new Error("Set MOCK_TRANSCRIPT_WEBHOOK_URL or pass an endpoint to sendDummyTranscript().");
  }
  if (!secret) {
    throw new Error("Set TRANSCRIPT_WEBHOOK_SECRET or pass a secret to sendDummyTranscript().");
  }

  const url = new URL(endpoint);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const localHttp = url.protocol === "http:" && loopbackHosts.has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("The dummy transcript endpoint must use HTTPS unless it is a local loopback address.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive number.");
  }

  const sentAt = now();
  const packet = await buildDummyTranscriptPacket({ fixtureDirectory, now: () => sentAt });
  const rawBody = JSON.stringify(packet);
  const webhookTimestamp = Math.floor(sentAt.getTime() / 1_000).toString();
  const signature = createDummyTranscriptSignature(secret, webhookTimestamp, rawBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "anda-dashboard-dummy-transcript/1.0",
        "x-anda-event-id": packet.eventId,
        "x-anda-event-type": packet.eventType,
        [TRANSCRIPT_TIMESTAMP_HEADER]: webhookTimestamp,
        [TRANSCRIPT_SIGNATURE_HEADER]: signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText.trim().slice(0, 500);
    throw new Error(`Dummy transcript delivery failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }

  return {
    status: response.status,
    responseBody: parseResponseBody(responseText),
    packet,
  };
}

export function createDummyTranscriptSignature(secret, timestamp, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex")}`;
}

function parseResponseBody(responseText) {
  if (!responseText.trim()) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

async function runCli() {
  const argumentsList = process.argv.slice(2);
  const dryRun = argumentsList.includes("--dry-run");
  const endpoint = argumentsList.find((argument) => !argument.startsWith("--"));

  if (dryRun) {
    const packet = await buildDummyTranscriptPacket();
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
    return;
  }

  const result = await sendDummyTranscript({ endpoint });
  process.stdout.write(`Dummy transcript delivered successfully (HTTP ${result.status}).\n`);
  if (result.responseBody !== null) {
    process.stdout.write(`${JSON.stringify(result.responseBody, null, 2)}\n`);
  }
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
