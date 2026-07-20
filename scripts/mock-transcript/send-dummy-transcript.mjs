import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");

export const DEFAULT_FIXTURE_DIRECTORY = resolve(repositoryRoot, "fixtures/transcripts");
export const DEFAULT_TIMEOUT_MS = 10_000;
export const READ_AI_SIGNATURE_HEADER = "x-read-signature";

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
} = {}) {
  const { metadata, content } = await loadDummyTranscriptFixtures({ fixtureDirectory });
  const speakerBlocks = buildSpeakerBlocks(content, metadata.start_time, metadata.end_time);
  return {
    ...metadata,
    transcript: {
      ...metadata.transcript,
      speaker_blocks: speakerBlocks,
    },
  };
}

export async function sendDummyTranscript({
  endpoint = process.env.MOCK_TRANSCRIPT_WEBHOOK_URL,
  signingKey = process.env.READ_AI_WEBHOOK_SIGNING_KEY,
  fetchImplementation = globalThis.fetch,
  fixtureDirectory = DEFAULT_FIXTURE_DIRECTORY,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!endpoint) {
    throw new Error("Set MOCK_TRANSCRIPT_WEBHOOK_URL or pass an endpoint to sendDummyTranscript().");
  }
  if (!signingKey) {
    throw new Error("Set READ_AI_WEBHOOK_SIGNING_KEY or pass a signing key to sendDummyTranscript().");
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

  const packet = await buildDummyTranscriptPacket({ fixtureDirectory });
  const rawBody = JSON.stringify(packet);
  const signature = createDummyTranscriptSignature(signingKey, rawBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "anda-dashboard-read-ai-fixture/1.0",
        [READ_AI_SIGNATURE_HEADER]: signature,
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

export function createDummyTranscriptSignature(signingKey, rawBody) {
  const keyBytes = decodeSigningKey(signingKey);
  return createHmac("sha256", keyBytes).update(rawBody, "utf8").digest("hex");
}

function decodeSigningKey(signingKey) {
  const value = signingKey.trim();
  const keyBytes = Buffer.from(value, "base64");
  if (!value || keyBytes.length < 16 || keyBytes.toString("base64") !== value) {
    throw new Error("READ_AI_WEBHOOK_SIGNING_KEY must be valid Base64 and decode to at least 16 bytes.");
  }
  return keyBytes;
}

function buildSpeakerBlocks(content, startTime, endTime) {
  const turns = content.split(/\r?\n\s*\r?\n/gu).map((turn) => turn.trim()).filter(Boolean);
  if (turns.length === 0) throw new Error("The dummy transcript fixture has no speaker turns.");
  const meetingStart = Date.parse(startTime);
  const meetingEnd = Date.parse(endTime);
  if (!Number.isFinite(meetingStart) || !Number.isFinite(meetingEnd) || meetingEnd <= meetingStart) {
    throw new Error("The dummy Read AI fixture has invalid meeting timestamps.");
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
  process.stdout.write(`Read AI transcript fixture delivered successfully (HTTP ${result.status}).\n`);
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
