import { spawn } from "node:child_process";
import { resolve } from "node:path";

const FIRMA_BASE_URL = "https://api.firma.dev/functions/v1/signing-request-api/";
const localPort = Number(process.env.FIRMA_CALLBACK_LOCAL_PORT ?? "3010");
const cloudflaredPath = process.env.FIRMA_CLOUDFLARED_PATH
  ?? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const apiKey = requiredSecret("FIRMA_API_KEY");
const workspaceId = requiredUuid("FIRMA_WORKSPACE_ID");
requiredSecret("FIRMA_WEBHOOK_SECRET");
const preflightOnly = process.argv.includes("--preflight-only");
const manualFrontend = process.argv.includes("--manual-frontend");
const liveTreasurerProfileId = optionalUuid(
  "FIRMA_LIVE_TREASURER_PROFILE_ID",
  "10000000-0000-4000-8000-000000000006",
);

let nextProcess;
let tunnelProcess;
let webhookId;

try {
  nextProcess = spawn(process.execPath, [
    resolve("node_modules/next/dist/bin/next"),
    "dev",
    "--port",
    String(localPort),
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ANDA_DEV_ACTOR_PROFILE_ID: liveTreasurerProfileId },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeOutput(nextProcess, "next");
  await waitForServer(`http://127.0.0.1:${localPort}/api/webhooks/firma`, nextProcess);

  tunnelProcess = spawn(cloudflaredPath, [
    "tunnel",
    "--url",
    `http://127.0.0.1:${localPort}`,
    "--no-autoupdate",
  ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const publicUrl = await waitForTunnel(tunnelProcess);
  const callbackUrl = new URL("/api/webhooks/firma", publicUrl).href;
  process.stdout.write(`\nTemporary Firma callback: ${callbackUrl}\n`);
  await waitForPublicCallback(callbackUrl, tunnelProcess);

  webhookId = await createWebhook(callbackUrl, workspaceId, apiKey);
  process.stdout.write(`Temporary Firma webhook created: ${webhookId}\n\n`);

  await testWebhook(webhookId, apiKey);
  process.stdout.write("Firma webhook test delivery succeeded.\n\n");

  if (preflightOnly) {
    process.stdout.write("Webhook preflight completed; no meeting, signing request, or archive was created.\n");
  } else if (manualFrontend) {
    process.stdout.write([
      "Manual frontend signing environment is ready.",
      "",
      `Frontend: http://127.0.0.1:${localPort}/app/dashboard`,
      `Transcript webhook: http://127.0.0.1:${localPort}/api/webhooks/transcripts`,
      "",
      "In a second terminal, create the meeting with:",
      `npm.cmd run mock:transcript -- http://127.0.0.1:${localPort}/api/webhooks/transcripts`,
      "",
      "Complete review, approval, Treasurer signing, and archive verification in the frontend.",
      "Keep this terminal open so the temporary Firma callback remains available.",
      "Press Ctrl+C after the meeting appears in the archive.",
      "",
    ].join("\n"));
    await waitForManualShutdown();
  } else {
    const exitCode = await runVitest({
      ...process.env,
      RUN_FIRMA_CALLBACK_LIVE_TEST: "1",
      FIRMA_CALLBACK_PUBLIC_URL: callbackUrl,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
  }
} finally {
  if (webhookId) {
    try {
      await deleteWebhook(webhookId, apiKey);
      process.stdout.write(`\nTemporary Firma webhook removed: ${webhookId}\n`);
    } catch (error) {
      process.stderr.write(`Could not remove temporary Firma webhook ${webhookId}: ${safeMessage(error)}\n`);
      process.exitCode = process.exitCode || 1;
    }
  }
  stopProcess(tunnelProcess);
  stopProcess(nextProcess);
}

async function createWebhook(callbackUrl, workspaceId, key) {
  const response = await fetch(new URL("webhooks", FIRMA_BASE_URL), {
    method: "POST",
    headers: firmaHeaders(key),
    body: JSON.stringify({
      url: callbackUrl,
      workspace_id: workspaceId,
      events: [
        "signing_request.completed",
        "signing_request.recipient.signed",
        "signing_request.recipient.declined",
        "signing_request.expired",
        "signing_request.cancelled",
      ],
      description: "Temporary ANDA local live callback test",
    }),
  });
  const body = await readJson(response);
  if (!response.ok || typeof body?.id !== "string") {
    throw new Error(`Firma webhook creation failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body.id;
}

async function testWebhook(id, key) {
  const response = await fetch(new URL(`webhooks/${encodeURIComponent(id)}/test`, FIRMA_BASE_URL), {
    method: "POST",
    headers: firmaHeaders(key),
  });
  const body = await readJson(response);
  if (
    !response.ok
    || body?.success !== true
    || typeof body?.status_code !== "number"
    || body.status_code < 200
    || body.status_code >= 300
  ) {
    throw new Error(`Firma webhook test delivery failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
}

async function deleteWebhook(id, key) {
  const response = await fetch(new URL(`webhooks/${encodeURIComponent(id)}`, FIRMA_BASE_URL), {
    method: "DELETE",
    headers: firmaHeaders(key),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Firma webhook deletion failed with HTTP ${response.status}.`);
  }
}

function firmaHeaders(key) {
  return {
    authorization: key,
    accept: "application/json",
    "content-type": "application/json",
    "x-api-version": "1",
  };
}

async function runVitest(environment) {
  const child = spawn(process.execPath, [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    "tests/integration/firma-callback.live.integration.test.ts",
  ], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The Next.js callback server stopped before becoming ready.");
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {}
    await delay(500);
  }
  throw new Error("The Next.js callback server did not become ready within 60 seconds.");
}

function waitForTunnel(child) {
  return new Promise((resolveUrl, reject) => {
    const timeout = setTimeout(() => reject(new Error("cloudflared did not provide a public URL within 60 seconds.")), 60_000);
    const inspect = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[cloudflared] ${text}`);
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
      if (match) {
        clearTimeout(timeout);
        resolveUrl(match[0]);
      }
    };
    child.stdout?.on("data", inspect);
    child.stderr?.on("data", inspect);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`cloudflared stopped before creating a tunnel (exit ${code}).`));
    });
  });
}

async function waitForPublicCallback(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("cloudflared stopped before the public callback became ready.");
    try {
      const response = await fetch(url);
      if (response.status === 405) return;
    } catch {}
    await delay(1_000);
  }
  throw new Error("The public Firma callback did not become reachable within 60 seconds.");
}

function pipeOutput(child, label) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
}

function stopProcess(child) {
  if (child && child.exitCode === null) child.kill();
}

function requiredSecret(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("replace-")) throw new Error(`${name} is not configured.`);
  return value;
}

function requiredUuid(name) {
  const value = requiredSecret(name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

function optionalUuid(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error(`${name} must be a UUID.`);
  }
  return value;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function safeMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function waitForManualShutdown() {
  return new Promise((resolveShutdown) => {
    const finish = () => {
      process.stdout.write("\nStopping the manual frontend signing environment...\n");
      resolveShutdown();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}
